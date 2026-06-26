import { prisma } from '../../utils/prisma';
import { ForbiddenError, NotFoundError } from '../../utils/errors';
import { getIO } from '../../socket/index';
import { isSuperAdmin } from '../clubSession/clubSession.service';
import type { ClubMessageResponse, SkillLevel, SendMessageInput } from '@badminton/shared';

// 모임 멤버만 채팅/건의를 읽고 쓸 수 있다. (비멤버 → 403)
async function verifyClubMember(clubId: string, userId: string) {
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member) {
    // 최고관리자는 비멤버여도 이용 가능(전역 우회).
    if (await isSuperAdmin(userId)) return member;
    throw new ForbiddenError('모임 멤버만 이용할 수 있습니다');
  }
  return member;
}

// DB row(+author/profile include) → API 응답. 지목한 모임원 이름을 함께 해석한다.
// authorSkillLevel 은 모임별 급수(per-club): 작성자의 이 모임 ClubMember.skillLevel
// 오버라이드가 있으면 그 값, 없으면 작성자 본인 기본값(PlayerProfile.skillLevel).
// skillOverrideByUser 에 이 모임의 작성자별 오버라이드(있을 때만)가 담긴다.
function mapMessage(
  msg: {
    id: string;
    clubId: string;
    userId: string;
    text: string;
    type: string;
    mentionedUserIds: string[];
    createdAt: Date;
    user: { name: string; profile: { skillLevel: string | null } | null };
  },
  nameById: Map<string, string>,
  skillOverrideByUser: Map<string, string | null>,
): ClubMessageResponse {
  return {
    id: msg.id,
    clubId: msg.clubId,
    userId: msg.userId,
    authorName: msg.user.name,
    authorSkillLevel: (skillOverrideByUser.get(msg.userId) ??
      msg.user.profile?.skillLevel ??
      null) as SkillLevel | null,
    text: msg.text,
    type: msg.type as 'CHAT' | 'REQUEST',
    // 지목 순서를 유지하되, 더 이상 모임에 없는(이름 미해석) id 는 제외.
    mentioned: msg.mentionedUserIds
      .filter((id) => nameById.has(id))
      .map((id) => ({ userId: id, name: nameById.get(id)! })),
    createdAt: msg.createdAt.toISOString(),
  };
}

const messageInclude = {
  user: { select: { name: true, profile: { select: { skillLevel: true } } } },
} as const;

// 모임별 급수(per-club): 주어진 작성자들의 이 모임 ClubMember.skillLevel 오버라이드를
// 한 번에 조회. 행이 없으면(예: 더 이상 멤버가 아닌 작성자) 맵에 키 자체가 없어 본인
// 기본값으로 폴백된다. skillLevel 이 null(미설정)인 멤버는 null 로 담긴다.
async function resolveSkillOverrides(
  clubId: string,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const members = await prisma.clubMember.findMany({
    where: { clubId, userId: { in: unique } },
    select: { userId: true, skillLevel: true },
  });
  return new Map(members.map((m) => [m.userId, (m.skillLevel ?? null) as string | null]));
}

// 여러 메시지에서 등장하는 모든 지목 userId 의 이름을 한 번에 해석.
async function resolveMentionNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * 메시지 작성. 모임 멤버만 가능. type=REQUEST(짝 요청)이면 mentionedUserIds 에
 * 지목한 모임원이 담긴다 — 같은 모임의 멤버 id 만 유효한 것으로 남긴다.
 * 생성 후 club:<clubId> 룸으로 'clubMessage:new' 실시간 브로드캐스트.
 */
export async function createMessage(
  clubId: string,
  userId: string,
  input: SendMessageInput,
): Promise<ClubMessageResponse> {
  await verifyClubMember(clubId, userId);

  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } });
  if (!club) throw new NotFoundError('모임');

  // 지목 대상은 같은 모임의 멤버로 한정 (중복 제거).
  let validMentioned: string[] = [];
  const requested = Array.from(new Set(input.mentionedUserIds ?? []));
  if (requested.length > 0) {
    const members = await prisma.clubMember.findMany({
      where: { clubId, userId: { in: requested } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    validMentioned = requested.filter((id) => memberIds.has(id));
  }

  const created = await prisma.clubMessage.create({
    data: {
      clubId,
      userId,
      text: input.text,
      type: input.type ?? 'CHAT',
      mentionedUserIds: validMentioned,
    },
    include: messageInclude,
  });

  const nameById = await resolveMentionNames(created.mentionedUserIds);
  const skillOverrideByUser = await resolveSkillOverrides(clubId, [created.userId]);
  const response = mapMessage(created, nameById, skillOverrideByUser);

  getIO().to(`club:${clubId}`).emit('clubMessage:new', response);

  return response;
}

/**
 * 최근 메시지 조회 (오름차순; 화면 하단이 최신). 모임 멤버만.
 * before(ISO createdAt 커서)보다 과거의 메시지를 limit(≤50)개 가져온다.
 */
export async function listMessages(
  clubId: string,
  userId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ClubMessageResponse[]> {
  await verifyClubMember(clubId, userId);

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
  const before = opts.before ? new Date(opts.before) : undefined;
  const hasBefore = before && !Number.isNaN(before.getTime());

  // 최신순으로 limit개를 끊어 가져온 뒤 오름차순으로 뒤집어 반환.
  const rows = await prisma.clubMessage.findMany({
    where: {
      clubId,
      ...(hasBefore ? { createdAt: { lt: before } } : {}),
    },
    include: messageInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const ascending = rows.reverse();
  const nameById = await resolveMentionNames(
    ascending.flatMap((m) => m.mentionedUserIds),
  );
  const skillOverrideByUser = await resolveSkillOverrides(
    clubId,
    ascending.map((m) => m.userId),
  );
  return ascending.map((m) => mapMessage(m, nameById, skillOverrideByUser));
}

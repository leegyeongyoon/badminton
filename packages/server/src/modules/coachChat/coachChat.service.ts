import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { sendPushToUser } from '../notification/notification.service';

// ─────────────────────────────────────────────────────────────
// 코치 문의 채팅 — 클럽 담당자(또는 회원) ↔ 코치 1:1 스레드.
// guestChat 구조를 복제하되 양쪽 다 로그인 유저라 (coachUserId, userId)로
// find-or-create 하고, 접근은 두 당사자만 허용한다. 실시간은 폴링.
// ─────────────────────────────────────────────────────────────

export interface CoachMessageDTO {
  id: string;
  fromCoach: boolean;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CoachThreadView {
  threadId: string;
  coachUserId: string;
  userId: string;
  clubId: string | null;
  clubName: string | null;
  mineIsCoach: boolean; // 요청자가 코치 측인지(말풍선 좌우 전환용)
  coach: { profileId: string | null; displayName: string; photoUrl: string | null; certified: boolean };
  userName: string;
  messages: CoachMessageDTO[];
}

export interface CoachThreadRow {
  threadId: string;
  mineIsCoach: boolean;
  counterpartName: string;
  counterpartPhotoUrl: string | null;
  certified: boolean; // 상대(코치 측 표시용)
  clubName: string | null;
  lastText: string | null;
  lastMessageAt: string;
  unread: number; // 내 기준 안 읽음
}

function mapMsg(m: { id: string; fromCoach: boolean; authorName: string; text: string; createdAt: Date }): CoachMessageDTO {
  return { id: m.id, fromCoach: m.fromCoach, authorName: m.authorName, text: m.text, createdAt: m.createdAt.toISOString() };
}

async function coachSideInfo(coachUserId: string) {
  const profile = await prisma.coachProfile.findUnique({
    where: { userId: coachUserId },
    select: { id: true, displayName: true, photoUrl: true, certified: true },
  });
  if (profile) {
    return { profileId: profile.id, displayName: profile.displayName, photoUrl: profile.photoUrl, certified: profile.certified };
  }
  // 프로필이 삭제/비활성돼도 기존 스레드는 열려야 함 — 유저 이름으로 폴백.
  const user = await prisma.user.findUnique({ where: { id: coachUserId }, select: { name: true } });
  return { profileId: null, displayName: user?.name || '코치', photoUrl: null, certified: false };
}

async function clubNameOf(clubId: string | null): Promise<string | null> {
  if (!clubId) return null;
  const c = await prisma.club.findUnique({ where: { id: clubId }, select: { name: true } });
  return c?.name ?? null;
}

/** 스레드 시작(find-or-create) — 코치 프로필 기준. 본인에게는 문의 불가. */
export async function startThread(requesterId: string, coachProfileId: string, clubId?: string | null): Promise<CoachThreadView> {
  const profile = await prisma.coachProfile.findUnique({
    where: { id: coachProfileId },
    select: { userId: true, active: true },
  });
  if (!profile || !profile.active) throw new NotFoundError('코치');
  if (profile.userId === requesterId) throw new BadRequestError('내 프로필에는 문의할 수 없습니다');

  let thread = await prisma.coachThread.findUnique({
    where: { coachUserId_userId: { coachUserId: profile.userId, userId: requesterId } },
  });
  if (!thread) {
    thread = await prisma.coachThread.create({
      data: { coachUserId: profile.userId, userId: requesterId, clubId: clubId ?? null },
    });
  } else if (clubId && !thread.clubId) {
    thread = await prisma.coachThread.update({ where: { id: thread.id }, data: { clubId } });
  }
  return loadThread(thread.id, requesterId);
}

/** 스레드 로드 — 두 당사자만. 내 쪽 안 읽음 0으로. */
export async function loadThread(threadId: string, requesterId: string): Promise<CoachThreadView> {
  const thread = await prisma.coachThread.findUnique({
    where: { id: threadId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!thread) throw new NotFoundError('대화');
  const mineIsCoach = thread.coachUserId === requesterId;
  if (!mineIsCoach && thread.userId !== requesterId) throw new ForbiddenError();

  if (mineIsCoach && thread.coachUnread !== 0) {
    await prisma.coachThread.update({ where: { id: threadId }, data: { coachUnread: 0 } });
  } else if (!mineIsCoach && thread.userUnread !== 0) {
    await prisma.coachThread.update({ where: { id: threadId }, data: { userUnread: 0 } });
  }

  const [coach, user, clubName] = await Promise.all([
    coachSideInfo(thread.coachUserId),
    prisma.user.findUnique({ where: { id: thread.userId }, select: { name: true } }),
    clubNameOf(thread.clubId),
  ]);

  return {
    threadId: thread.id,
    coachUserId: thread.coachUserId,
    userId: thread.userId,
    clubId: thread.clubId,
    clubName,
    mineIsCoach,
    coach,
    userName: user?.name || '회원',
    messages: thread.messages.map(mapMsg),
  };
}

/** 메시지 전송 — 상대 안 읽음 +1, 상대에게 푸시. */
export async function sendMessage(threadId: string, requesterId: string, text: string): Promise<CoachMessageDTO> {
  const body = String(text ?? '').trim();
  if (!body) throw new BadRequestError('내용을 입력해 주세요');

  const thread = await prisma.coachThread.findUnique({ where: { id: threadId } });
  if (!thread) throw new NotFoundError('대화');
  const mineIsCoach = thread.coachUserId === requesterId;
  if (!mineIsCoach && thread.userId !== requesterId) throw new ForbiddenError();

  const authorName = mineIsCoach
    ? (await coachSideInfo(thread.coachUserId)).displayName
    : (await prisma.user.findUnique({ where: { id: requesterId }, select: { name: true } }))?.name || '회원';

  const msg = await prisma.coachMessage.create({
    data: { threadId, fromCoach: mineIsCoach, authorName, text: body.slice(0, 1000) },
  });
  await prisma.coachThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: msg.createdAt,
      lastText: body.slice(0, 200),
      ...(mineIsCoach ? { userUnread: { increment: 1 } } : { coachUnread: { increment: 1 } }),
    },
  });

  try {
    await sendPushToUser(mineIsCoach ? thread.userId : thread.coachUserId, {
      title: mineIsCoach ? `코치 답장 · ${authorName}` : `레슨 문의 · ${authorName}`,
      body: body.slice(0, 60),
      data: { type: 'coachChat', threadId },
    });
  } catch {
    /* 알림 실패 무시 */
  }
  return mapMsg(msg);
}

/** 내 스레드 목록 — 문의자로서(asUser) / 코치로서(asCoach) 분리해 반환. */
export async function listMyThreads(userId: string): Promise<{ asUser: CoachThreadRow[]; asCoach: CoachThreadRow[] }> {
  const [asUserRows, asCoachRows] = await Promise.all([
    prisma.coachThread.findMany({
      where: { userId, lastText: { not: null } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    }),
    prisma.coachThread.findMany({
      where: { coachUserId: userId, lastText: { not: null } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    }),
  ]);

  // 상대 표시 정보를 한 번에 로드(코치 프로필 / 유저 이름).
  const coachIds = [...new Set(asUserRows.map((t) => t.coachUserId))];
  const userIds = [...new Set(asCoachRows.map((t) => t.userId))];
  const clubIds = [...new Set([...asUserRows, ...asCoachRows].map((t) => t.clubId).filter(Boolean))] as string[];

  const [profiles, users, clubs] = await Promise.all([
    prisma.coachProfile.findMany({
      where: { userId: { in: coachIds } },
      select: { userId: true, displayName: true, photoUrl: true, certified: true },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true } }),
  ]);
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const clubMap = new Map(clubs.map((c) => [c.id, c.name]));

  return {
    asUser: asUserRows.map((t) => {
      const p = profileMap.get(t.coachUserId);
      return {
        threadId: t.id,
        mineIsCoach: false,
        counterpartName: p?.displayName || '코치',
        counterpartPhotoUrl: p?.photoUrl ?? null,
        certified: p?.certified ?? false,
        clubName: t.clubId ? clubMap.get(t.clubId) ?? null : null,
        lastText: t.lastText,
        lastMessageAt: t.lastMessageAt.toISOString(),
        unread: t.userUnread,
      };
    }),
    asCoach: asCoachRows.map((t) => ({
      threadId: t.id,
      mineIsCoach: true,
      counterpartName: userMap.get(t.userId) || '회원',
      counterpartPhotoUrl: null,
      certified: false,
      clubName: t.clubId ? clubMap.get(t.clubId) ?? null : null,
      lastText: t.lastText,
      lastMessageAt: t.lastMessageAt.toISOString(),
      unread: t.coachUnread,
    })),
  };
}

/** 내 미읽음 총합(문의자+코치 양쪽) — more 탭 뱃지용. */
export async function countMyUnread(userId: string): Promise<number> {
  const [asUser, asCoach] = await Promise.all([
    prisma.coachThread.aggregate({ where: { userId }, _sum: { userUnread: true } }),
    prisma.coachThread.aggregate({ where: { coachUserId: userId }, _sum: { coachUnread: true } }),
  ]);
  return (asUser._sum.userUnread ?? 0) + (asCoach._sum.coachUnread ?? 0);
}

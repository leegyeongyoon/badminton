import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { sendPushToUser, sendPushToUsers } from '../notification/notification.service';

// ─────────────────────────────────────────────────────────────
// 게스트 문의 채팅 — 비회원(익명)/앱 회원 게스트 ↔ 운영진 1:1 스레드.
//  • 게스트 측(공개): thread.id 를 토큰으로 사용(브라우저 localStorage 보관).
//    앱 회원이면 (clubId, guestUserId)로 묶어 기기가 바뀌어도 이어진다.
//  • 운영진 측(staff 가드): 클럽의 문의함에서 스레드 목록/대화/답장.
// 실시간은 게스트 익명 소켓 인증 부담을 피해 폴링으로 처리(스레드 열려있을 때).
// ─────────────────────────────────────────────────────────────

export interface GuestMessageDTO {
  id: string;
  fromStaff: boolean;
  authorName: string;
  text: string;
  createdAt: string;
}
export interface GuestThreadView {
  threadId: string;
  clubId: string;
  clubName: string;
  guestName: string | null;
  closed: boolean;
  messages: GuestMessageDTO[];
}
export interface StaffThreadRow {
  threadId: string;
  guestName: string | null;
  isAppUser: boolean;
  lastText: string | null;
  lastMessageAt: string;
  staffUnread: number;
  closed: boolean;
}

function mapMsg(m: { id: string; fromStaff: boolean; authorName: string; text: string; createdAt: Date }): GuestMessageDTO {
  return { id: m.id, fromStaff: m.fromStaff, authorName: m.authorName, text: m.text, createdAt: m.createdAt.toISOString() };
}

/** 초대코드 또는 clubId(PUBLIC)로 클럽 해석 — 게스트 진입 검증용. */
async function resolveClub(input: { clubId?: string; inviteCode?: string }): Promise<{ id: string; name: string } | null> {
  if (input.inviteCode) {
    const c = await prisma.club.findUnique({ where: { inviteCode: input.inviteCode.toUpperCase() }, select: { id: true, name: true } });
    return c ?? null;
  }
  if (input.clubId) {
    const c = await prisma.club.findUnique({ where: { id: input.clubId }, select: { id: true, name: true, visibility: true } });
    // clubId 진입은 공개 모임만(비공개는 초대코드로만).
    return c && c.visibility === 'PUBLIC' ? { id: c.id, name: c.name } : null;
  }
  return null;
}

/**
 * 게스트 스레드 시작/조회. 앱 회원(guestUserId)이면 find-or-create,
 * 익명이면 새로 만든다(클라가 반환 토큰을 보관). name 있으면 갱신.
 */
export async function startGuestThread(input: {
  clubId?: string; inviteCode?: string; guestUserId?: string | null; name?: string | null;
}): Promise<GuestThreadView> {
  const club = await resolveClub(input);
  if (!club) throw new NotFoundError('모임');
  const name = input.name ? String(input.name).trim().slice(0, 20) || null : null;

  let thread = input.guestUserId
    ? await prisma.guestThread.findFirst({ where: { clubId: club.id, guestUserId: input.guestUserId }, orderBy: { createdAt: 'desc' } })
    : null;
  if (!thread) {
    thread = await prisma.guestThread.create({
      data: { clubId: club.id, guestUserId: input.guestUserId ?? null, guestName: name },
    });
  } else if (name && name !== thread.guestName) {
    thread = await prisma.guestThread.update({ where: { id: thread.id }, data: { guestName: name } });
  }
  return loadThreadForGuest(thread.id);
}

/** 게스트 측 스레드 로드(토큰=threadId). 게스트의 안 읽음 0으로. */
export async function loadThreadForGuest(threadId: string): Promise<GuestThreadView> {
  const thread = await prisma.guestThread.findUnique({
    where: { id: threadId },
    include: {
      club: { select: { name: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  });
  if (!thread) throw new NotFoundError('문의');
  if (thread.guestUnread !== 0) {
    await prisma.guestThread.update({ where: { id: threadId }, data: { guestUnread: 0 } });
  }
  return {
    threadId: thread.id,
    clubId: thread.clubId,
    clubName: thread.club.name,
    guestName: thread.guestName,
    closed: thread.closed,
    messages: thread.messages.map(mapMsg),
  };
}

/** 게스트가 메시지 전송 → 운영진 안 읽음 +1, 운영진 푸시. */
export async function guestSendMessage(threadId: string, text: string, name?: string | null): Promise<GuestMessageDTO> {
  const body = String(text ?? '').trim();
  if (!body) throw new BadRequestError('내용을 입력해 주세요');
  const thread = await prisma.guestThread.findUnique({ where: { id: threadId }, include: { club: { select: { name: true } } } });
  if (!thread) throw new NotFoundError('문의');

  const trimmedName = name ? String(name).trim().slice(0, 20) : null;
  const authorName = trimmedName || thread.guestName || '게스트';

  const msg = await prisma.guestMessage.create({
    data: { threadId, fromStaff: false, authorName, text: body.slice(0, 1000) },
  });
  await prisma.guestThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: msg.createdAt,
      lastText: body.slice(0, 200),
      staffUnread: { increment: 1 },
      closed: false,
      ...(trimmedName && !thread.guestName ? { guestName: trimmedName } : {}),
    },
  });

  // 운영진(LEADER/STAFF)에게 문의 알림.
  try {
    const staff = await prisma.clubMember.findMany({
      where: { clubId: thread.clubId, role: { in: ['LEADER', 'STAFF'] } },
      select: { userId: true },
    });
    await sendPushToUsers(staff.map((s) => s.userId), {
      title: `게스트 문의 · ${thread.club.name}`,
      body: `${authorName}: ${body.slice(0, 60)}`,
      data: { type: 'guestChat', clubId: thread.clubId },
    });
  } catch {
    /* 알림 실패 무시 */
  }
  return mapMsg(msg);
}

/** 운영진: 클럽 문의 스레드 목록(최근 순). */
export async function listStaffThreads(clubId: string): Promise<StaffThreadRow[]> {
  const rows = await prisma.guestThread.findMany({
    where: { clubId },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  return rows.map((t) => ({
    threadId: t.id,
    guestName: t.guestName,
    isAppUser: !!t.guestUserId,
    lastText: t.lastText,
    lastMessageAt: t.lastMessageAt.toISOString(),
    staffUnread: t.staffUnread,
    closed: t.closed,
  }));
}

/** 운영진: 스레드 대화 로드. 소유권(clubId) 확인 + 운영진 안 읽음 0. */
export async function loadThreadForStaff(clubId: string, threadId: string): Promise<GuestThreadView> {
  const thread = await prisma.guestThread.findUnique({
    where: { id: threadId },
    include: { club: { select: { name: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!thread || thread.clubId !== clubId) throw new NotFoundError('문의');
  if (thread.staffUnread !== 0) {
    await prisma.guestThread.update({ where: { id: threadId }, data: { staffUnread: 0 } });
  }
  return {
    threadId: thread.id,
    clubId: thread.clubId,
    clubName: thread.club.name,
    guestName: thread.guestName,
    closed: thread.closed,
    messages: thread.messages.map(mapMsg),
  };
}

/** 운영진 답장 → 게스트 안 읽음 +1, 앱 회원 게스트면 푸시. */
export async function staffSendMessage(clubId: string, threadId: string, staffUserId: string, text: string): Promise<GuestMessageDTO> {
  const body = String(text ?? '').trim();
  if (!body) throw new BadRequestError('내용을 입력해 주세요');
  const thread = await prisma.guestThread.findUnique({ where: { id: threadId }, include: { club: { select: { name: true } } } });
  if (!thread || thread.clubId !== clubId) throw new NotFoundError('문의');

  const staff = await prisma.user.findUnique({ where: { id: staffUserId }, select: { name: true } });
  const msg = await prisma.guestMessage.create({
    data: { threadId, fromStaff: true, userId: staffUserId, authorName: staff?.name || '운영진', text: body.slice(0, 1000) },
  });
  await prisma.guestThread.update({
    where: { id: threadId },
    data: { lastMessageAt: msg.createdAt, lastText: body.slice(0, 200), guestUnread: { increment: 1 } },
  });

  // 앱 회원 게스트에게 답장 푸시(익명은 보낼 곳 없음 — 폴링으로 확인).
  if (thread.guestUserId) {
    try {
      await sendPushToUser(thread.guestUserId, {
        title: `${thread.club.name} 운영진 답장`,
        body: body.slice(0, 60),
        data: { type: 'guestChatReply', threadId },
      });
    } catch {
      /* 알림 실패 무시 */
    }
  }
  return mapMsg(msg);
}

/** 운영진: 스레드 종료/재개 토글. */
export async function setThreadClosed(clubId: string, threadId: string, closed: boolean): Promise<void> {
  const thread = await prisma.guestThread.findUnique({ where: { id: threadId }, select: { clubId: true } });
  if (!thread || thread.clubId !== clubId) throw new NotFoundError('문의');
  await prisma.guestThread.update({ where: { id: threadId }, data: { closed } });
}

/** 클럽의 미읽음 문의 스레드 수(운영진 뱃지용). */
export async function countStaffUnreadThreads(clubId: string): Promise<number> {
  return prisma.guestThread.count({ where: { clubId, staffUnread: { gt: 0 } } });
}

import { prisma } from '../../utils/prisma';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../utils/errors';
import { verifyClubStaff } from '../clubSession/clubSession.service';
import { getCheckedInUsers } from '../checkin/checkin.service';
import { sendPushToUsers } from '../notification/notification.service';
import { getIO } from '../../socket';

// ─────────────────────────────────────────────────────────────
// 정모 즉석 투표 — 운영진이 정모 중 만들고, 체크인한 회원이 참여.
// 뒤풀이 인원·다음 요일 등. 체크인 데이터와 묶여 "실제 참석자에게만" 물어본다.
// ─────────────────────────────────────────────────────────────

export interface PollOptionResult {
  index: number;
  text: string;
  count: number;
  voters?: { userId: string; name: string }[]; // 익명 아니고 운영진이 볼 때만
}

export interface PollView {
  id: string;
  clubSessionId: string;
  question: string;
  options: PollOptionResult[];
  anonymous: boolean;
  multi: boolean;
  status: string; // OPEN | CLOSED
  totalVoters: number;
  myVotes: number[]; // 내가 고른 optionIndex들
  createdAt: string;
  closesAt: string | null;
}

async function requireSessionStaff(clubSessionId: string, userId: string) {
  const s = await prisma.clubSession.findUnique({ where: { id: clubSessionId }, select: { clubId: true, facilityId: true, status: true } });
  if (!s) throw new NotFoundError('정모');
  await verifyClubStaff(s.clubId, userId);
  return s;
}

/** 이 정모에 지금 체크인 중인지(투표 자격). */
async function isCheckedIn(clubSessionId: string, userId: string): Promise<boolean> {
  const c = await prisma.checkIn.findFirst({ where: { clubSessionId, userId, checkedOutAt: null }, select: { id: true } });
  return !!c;
}

function emitPollChanged(clubSessionId: string, facilityId: string, pollId: string, event: 'poll:created' | 'poll:updated' | 'poll:closed') {
  try {
    const io = getIO();
    const payload = { clubSessionId, pollId };
    io.to(`facility:${facilityId}`).emit(event as never, payload as never);
    io.to(`clubSession:${clubSessionId}`).emit(event as never, payload as never);
  } catch {
    /* 소켓 실패는 무시 — 폴링 폴백이 있음 */
  }
}

/** 투표 생성(운영진) → 체크인 회원 전원 푸시. */
export async function createPoll(
  clubSessionId: string,
  userId: string,
  input: { question?: string; options?: string[]; anonymous?: boolean; multi?: boolean; closesInMin?: number },
): Promise<PollView> {
  const s = await requireSessionStaff(clubSessionId, userId);
  if (s.status !== 'ACTIVE') throw new BadRequestError('진행 중인 정모에서만 투표를 열 수 있어요.');
  const question = String(input.question ?? '').trim();
  if (!question) throw new BadRequestError('질문을 입력해 주세요.');
  if (question.length > 100) throw new BadRequestError('질문은 100자 이내로 입력해 주세요.');
  const options = (input.options ?? []).map((o) => String(o ?? '').trim()).filter(Boolean).slice(0, 8);
  if (options.length < 2) throw new BadRequestError('선택지를 2개 이상 입력해 주세요.');

  const closesAt =
    input.closesInMin && input.closesInMin > 0 ? new Date(Date.now() + Math.min(input.closesInMin, 1440) * 60 * 1000) : null;

  const poll = await prisma.sessionPoll.create({
    data: {
      clubSessionId,
      createdById: userId,
      question,
      options,
      anonymous: !!input.anonymous,
      multi: !!input.multi,
      closesAt,
    },
  });

  // 체크인 회원 전원에게 푸시(만든 사람 제외). 실패해도 생성은 성공.
  try {
    const checkedIn = await getCheckedInUsers(s.facilityId, clubSessionId);
    const ids = checkedIn.map((c) => c.userId).filter((id) => id !== userId);
    if (ids.length > 0) {
      await sendPushToUsers(ids, {
        title: '정모 투표 📊',
        body: question,
        data: { type: 'poll_created', clubSessionId, pollId: poll.id },
      });
    }
  } catch {
    /* 알림 실패 무시 */
  }

  emitPollChanged(clubSessionId, s.facilityId, poll.id, 'poll:created');
  return getPoll(poll.id, userId);
}

/** 정모의 투표 목록(참여자·운영진 공용). */
export async function listPolls(clubSessionId: string, userId: string): Promise<PollView[]> {
  const polls = await prisma.sessionPoll.findMany({ where: { clubSessionId }, orderBy: { createdAt: 'desc' } });
  return Promise.all(polls.map((p) => buildView(p, userId)));
}

export async function getPoll(pollId: string, userId: string): Promise<PollView> {
  const poll = await prisma.sessionPoll.findUnique({ where: { id: pollId } });
  if (!poll) throw new NotFoundError('투표');
  return buildView(poll, userId);
}

async function buildView(poll: { id: string; clubSessionId: string; question: string; options: unknown; anonymous: boolean; multi: boolean; status: string; createdAt: Date; closesAt: Date | null; createdById: string }, userId: string): Promise<PollView> {
  const optionTexts = Array.isArray(poll.options) ? (poll.options as string[]) : [];
  const votes = await prisma.pollVote.findMany({
    where: { pollId: poll.id },
    include: { poll: false },
  });
  // 명단 필요 여부: 익명 아니고, 요청자가 운영진일 때만.
  let showVoters = false;
  if (!poll.anonymous) {
    const s = await prisma.clubSession.findUnique({ where: { id: poll.clubSessionId }, select: { clubId: true } });
    if (s) {
      try { await verifyClubStaff(s.clubId, userId); showVoters = true; } catch { showVoters = false; }
    }
  }
  const nameById = new Map<string, string>();
  if (showVoters) {
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(votes.map((v) => v.userId))] } }, select: { id: true, name: true } });
    users.forEach((u) => nameById.set(u.id, u.name));
  }
  const options: PollOptionResult[] = optionTexts.map((text, index) => {
    const forOpt = votes.filter((v) => v.optionIndex === index);
    return {
      index,
      text,
      count: forOpt.length,
      ...(showVoters ? { voters: forOpt.map((v) => ({ userId: v.userId, name: nameById.get(v.userId) ?? '알 수 없음' })) } : {}),
    };
  });
  const myVotes = votes.filter((v) => v.userId === userId).map((v) => v.optionIndex);
  const totalVoters = new Set(votes.map((v) => v.userId)).size;
  return {
    id: poll.id,
    clubSessionId: poll.clubSessionId,
    question: poll.question,
    options,
    anonymous: poll.anonymous,
    multi: poll.multi,
    status: poll.status,
    totalVoters,
    myVotes,
    createdAt: poll.createdAt.toISOString(),
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
  };
}

/** 투표 참여(체크인 회원). 단일 선택이면 이전 표를 대체, 복수면 토글. */
export async function vote(pollId: string, userId: string, optionIndex: number): Promise<PollView> {
  const poll = await prisma.sessionPoll.findUnique({ where: { id: pollId }, include: { session: { select: { facilityId: true } } } });
  if (!poll) throw new NotFoundError('투표');
  if (poll.status !== 'OPEN') throw new BadRequestError('마감된 투표예요.');
  if (poll.closesAt && poll.closesAt.getTime() < Date.now()) throw new BadRequestError('마감된 투표예요.');
  const optionTexts = Array.isArray(poll.options) ? (poll.options as string[]) : [];
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= optionTexts.length) throw new BadRequestError('잘못된 선택지예요.');
  if (!(await isCheckedIn(poll.clubSessionId, userId))) throw new ForbiddenError('정모에 체크인한 회원만 참여할 수 있어요.');

  if (poll.multi) {
    // 복수: 같은 선택지 다시 누르면 취소(토글).
    const existing = await prisma.pollVote.findUnique({ where: { pollId_userId_optionIndex: { pollId, userId, optionIndex } } });
    if (existing) await prisma.pollVote.delete({ where: { id: existing.id } });
    else await prisma.pollVote.create({ data: { pollId, userId, optionIndex } });
  } else {
    // 단일: 이전 표 모두 지우고 이번 것만. 같은 걸 다시 누르면 취소.
    const mine = await prisma.pollVote.findMany({ where: { pollId, userId } });
    const already = mine.find((v) => v.optionIndex === optionIndex);
    await prisma.pollVote.deleteMany({ where: { pollId, userId } });
    if (!already) await prisma.pollVote.create({ data: { pollId, userId, optionIndex } });
  }
  emitPollChanged(poll.clubSessionId, poll.session.facilityId, pollId, 'poll:updated');
  return getPoll(pollId, userId);
}

/** 투표 마감(운영진). */
export async function closePoll(pollId: string, userId: string): Promise<PollView> {
  const poll = await prisma.sessionPoll.findUnique({ where: { id: pollId }, include: { session: { select: { clubId: true, facilityId: true } } } });
  if (!poll) throw new NotFoundError('투표');
  await verifyClubStaff(poll.session.clubId, userId);
  if (poll.status !== 'CLOSED') {
    await prisma.sessionPoll.update({ where: { id: pollId }, data: { status: 'CLOSED', closedAt: new Date() } });
    emitPollChanged(poll.clubSessionId, poll.session.facilityId, pollId, 'poll:closed');
  }
  return getPoll(pollId, userId);
}

/** 투표 삭제(운영진). */
export async function deletePoll(pollId: string, userId: string): Promise<void> {
  const poll = await prisma.sessionPoll.findUnique({ where: { id: pollId }, include: { session: { select: { clubId: true, facilityId: true } } } });
  if (!poll) throw new NotFoundError('투표');
  await verifyClubStaff(poll.session.clubId, userId);
  await prisma.sessionPoll.delete({ where: { id: pollId } });
  emitPollChanged(poll.clubSessionId, poll.session.facilityId, pollId, 'poll:closed');
}

/** 정모 종료 시 열린 투표 자동 마감(clubSession.endSession에서 호출). */
export async function closePollsForSession(clubSessionId: string): Promise<void> {
  await prisma.sessionPoll.updateMany({
    where: { clubSessionId, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
}

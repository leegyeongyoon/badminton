import { prisma } from '../../utils/prisma';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { getIO } from '../../socket';

// ─── 회원 경기 후 반응 + AI 편성 결과 기록 ───────────────────────────────
// · 회원: 판이 끝나면 그 판 선수에게 'game:feedbackAsk' → 앱이 "방금 경기 어땠어요?"를 띄우고 한 번 누른다.
// · AI 편성 결과: AI가 짠 대기 게임이 코트에 들어갈 때(그대로/고침) 또는 지워질 때 한 줄(AutoMatchEdit).
// 둘 다 AI 설정 화면의 '학습 현황'과 clubStyle 재학습에 쓴다.

export const FEEDBACK_RATINGS = ['GOOD', 'OK', 'BAD'] as const;
export const FEEDBACK_REASONS = ['TOO_HARD', 'TOO_EASY', 'REPEAT', 'WAIT'] as const;
const PENDING_WINDOW_MS = 40 * 60 * 1000; // 끝난 뒤 40분 안의 판만 물어본다

export async function recordAutoEdit(
  entry: { aiPlayerIds: string[]; playerIds: string[] },
  clubId: string,
  clubSessionId: string,
  action: 'PLAYED' | 'DELETED',
) {
  if (entry.aiPlayerIds.length !== 4) return; // 사람이 짠 게임
  const same = entry.playerIds.length === 4 && entry.aiPlayerIds.every((id) => entry.playerIds.includes(id));
  await prisma.autoMatchEdit
    .create({
      data: {
        clubId,
        clubSessionId,
        aiPlayerIds: entry.aiPlayerIds,
        finalPlayerIds: entry.playerIds,
        action: action === 'DELETED' ? 'DELETED' : same ? 'KEPT' : 'EDITED',
      },
    })
    .catch(() => {}); // 기록 실패가 편성을 막으면 안 됨
}

/** 판이 끝나면 그 판 선수들에게 반응을 물어본다(정모 판만). */
export function askFeedback(turn: { id: string; clubSessionId: string | null; players: { userId: string }[] }) {
  if (!turn.clubSessionId) return;
  const io = getIO();
  for (const p of turn.players) io.to(`user:${p.userId}`).emit('game:feedbackAsk', { turnId: turn.id, clubSessionId: turn.clubSessionId });
}

async function turnForFeedback(turnId: string) {
  return prisma.courtTurn.findUnique({
    where: { id: turnId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      clubSessionId: true,
      court: { select: { name: true } },
      clubSession: { select: { clubId: true } },
      players: { select: { userId: true, user: { select: { name: true } } } },
    },
  });
}

/** 이 회원이 아직 반응을 안 남긴 가장 최근 끝난 정모 판(40분 안). 없으면 null. */
export async function pendingFeedback(userId: string, turnId?: string) {
  const since = new Date(Date.now() - PENDING_WINDOW_MS);
  const turn = turnId
    ? await turnForFeedback(turnId)
    : await prisma.courtTurn
        .findFirst({
          where: {
            status: 'COMPLETED',
            clubSessionId: { not: null },
            completedAt: { gte: since },
            players: { some: { userId } },
          },
          orderBy: { completedAt: 'desc' },
          select: { id: true },
        })
        .then((t) => (t ? turnForFeedback(t.id) : null));
  if (!turn || turn.status !== 'COMPLETED' || !turn.clubSessionId || !turn.players.some((p) => p.userId === userId)) return null;
  if (!turn.completedAt || turn.completedAt < since) return null;
  // 지금 다른 판을 치는 중이면 묻지 않는다(코트 위에서 폰 볼 일 없음 — 끝나면 그 판을 묻는다).
  const playingNow = await prisma.courtTurn.count({ where: { status: 'PLAYING', players: { some: { userId } } } });
  if (playingNow > 0) return null;
  // 그 판 뒤에 다른 정모에 출석했다면 이전 정모 판은 묻지 않는다(모임이 여러 개거나 다음 정모가 바로 이어질 때).
  const newer = await prisma.checkIn.count({
    where: { userId, checkedInAt: { gt: turn.completedAt }, clubSessionId: { not: turn.clubSessionId } },
  });
  if (newer > 0) return null;
  const done = await prisma.gameFeedback.findUnique({ where: { turnId_userId: { turnId: turn.id, userId } } });
  if (done) return null;
  return {
    turnId: turn.id,
    courtName: turn.court?.name ?? '',
    completedAt: turn.completedAt.toISOString(),
    others: turn.players.filter((p) => p.userId !== userId).map((p) => p.user?.name ?? ''),
  };
}

export async function submitFeedback(userId: string, turnId: string, rating: string, reason?: string | null) {
  if (!(FEEDBACK_RATINGS as readonly string[]).includes(rating)) throw new BadRequestError('반응은 좋았어요·괜찮았어요·아쉬웠어요 중 하나예요');
  if (reason != null && !(FEEDBACK_REASONS as readonly string[]).includes(reason)) throw new BadRequestError('알 수 없는 이유예요');
  const turn = await turnForFeedback(turnId);
  if (!turn || !turn.clubSessionId || !turn.clubSession) throw new NotFoundError('경기');
  if (!turn.players.some((p) => p.userId === userId)) throw new ForbiddenError('이 경기에 뛴 분만 남길 수 있어요');
  if (turn.status !== 'COMPLETED') throw new BadRequestError('끝난 경기에만 남길 수 있어요');
  const data = { rating, reason: rating === 'BAD' ? reason ?? null : null };
  await prisma.gameFeedback.upsert({
    where: { turnId_userId: { turnId, userId } },
    create: { turnId, userId, clubId: turn.clubSession.clubId, clubSessionId: turn.clubSessionId, ...data },
    update: data,
  });
  return { ok: true };
}

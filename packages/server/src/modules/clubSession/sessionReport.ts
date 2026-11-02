import { prisma } from '../../utils/prisma';

// ─── 오늘 정모 리포트(운영 비서) ───
// 숫자는 전부 서버가 기록에서 계산하고, LLM은 그 숫자를 운영진이 읽기 쉬운 세 줄로만 정리한다(숫자를 지어내지 않게
// 계산된 JSON만 넘기고, 실패하면 숫자만 보여 준다). 진행 중에도, 끝난 뒤에도 볼 수 있다.

export interface SessionReport {
  sessionId: string;
  ended: boolean;
  minutes: number;
  games: number;
  players: number;
  avgGameMin: number | null;
  gamesPerPerson: { min: number; median: number; max: number };
  mixedPct: number | null;
  longWaits: { name: string; minutes: number }[]; // 한 번에 25분 넘게 기다린 사람(가장 긴 대기)
  noGames: { name: string; stayedMin: number }[]; // 30분 넘게 있었는데 0판
  fewGames: { name: string; games: number; perHour: number }[]; // 있던 시간 대비 판수가 적은 사람(중앙값의 60% 미만)
  sameFourRepeats: number; // 같은 4명이 다시 친 판
  ai: { games: number; kept: number; edited: number; deleted: number; commands: number; commandsOk: number };
  feedback: { total: number; good: number; ok: number; bad: number; reasons: Record<string, number> };
  resultsRecorded: number;
  summary: string[] | null;
}

const summaryCache = new Map<string, { key: string; lines: string[] }>();

export async function buildSessionReport(sessionId: string, withSummary = true): Promise<SessionReport> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true, startedAt: true, endedAt: true, status: true },
  });
  if (!session) throw new Error('세션 없음');
  const endMs = (session.endedAt ?? new Date()).getTime();
  const [turns, playing, checkins, edits, cmds, fb] = await Promise.all([
    prisma.courtTurn.findMany({
      where: { clubSessionId: sessionId, status: 'COMPLETED' },
      select: { startedAt: true, completedAt: true, winnerIds: true, players: { select: { userId: true } } },
      orderBy: { startedAt: 'asc' },
    }),
    // 지금 코트에서 치는 사람은 '기다리는 중'이 아니다.
    prisma.courtTurn.findMany({
      where: { clubSessionId: sessionId, status: 'PLAYING' },
      select: { players: { select: { userId: true } } },
    }),
    prisma.checkIn.findMany({
      where: { clubSessionId: sessionId },
      select: { userId: true, checkedInAt: true, checkedOutAt: true },
    }),
    prisma.autoMatchEdit.groupBy({ by: ['action'], where: { clubSessionId: sessionId }, _count: true }),
    prisma.aiCommandLog.findMany({ where: { clubSessionId: sessionId }, select: { outcome: true } }),
    prisma.gameFeedback.findMany({ where: { clubSessionId: sessionId }, select: { rating: true, reason: true } }),
  ]);
  const uids = Array.from(new Set([...checkins.map((c) => c.userId), ...turns.flatMap((t) => t.players.map((p) => p.userId))]));
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }),
    prisma.playerProfile.findMany({ where: { userId: { in: uids } }, select: { userId: true, gender: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const genderOf = new Map(profiles.map((p) => [p.userId, p.gender]));

  // 사람별: 있던 구간(첫 체크인 ~ 체크아웃/끝), 판 시작·끝 목록
  const stay = new Map<string, { from: number; to: number }>();
  for (const c of checkins) {
    const from = c.checkedInAt.getTime();
    const to = Math.min(endMs, c.checkedOutAt?.getTime() ?? endMs);
    const s = stay.get(c.userId);
    stay.set(c.userId, s ? { from: Math.min(s.from, from), to: Math.max(s.to, to) } : { from, to });
  }
  const playsOf = new Map<string, { s: number; e: number }[]>();
  let mixed = 0;
  let fours = 0;
  const groupSeen = new Map<string, number>();
  const durs: number[] = [];
  for (const t of turns) {
    if (!t.startedAt || !t.completedAt) continue;
    const s = t.startedAt.getTime();
    const e = t.completedAt.getTime();
    durs.push((e - s) / 60000);
    const ids = t.players.map((p) => p.userId);
    for (const id of ids) playsOf.set(id, [...(playsOf.get(id) ?? []), { s, e }]);
    if (ids.length === 4) {
      fours++;
      const g = ids.map((id) => genderOf.get(id));
      if (g.includes('M') && g.includes('F')) mixed++;
      const k = [...ids].sort().join('|');
      groupSeen.set(k, (groupSeen.get(k) ?? 0) + 1);
    }
  }
  const people = Array.from(stay.keys());
  const playingNow = new Set(playing.flatMap((t) => t.players.map((p) => p.userId)));
  const gamesOf = (id: string) => playsOf.get(id)?.length ?? 0;
  const counts = people.map(gamesOf).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;

  const longWaits: { name: string; minutes: number }[] = [];
  const noGames: { name: string; stayedMin: number }[] = [];
  const fewGames: { name: string; games: number; perHour: number }[] = [];
  const rates: number[] = [];
  for (const id of people) {
    const st = stay.get(id)!;
    const stayedMin = (st.to - st.from) / 60000;
    const plays = (playsOf.get(id) ?? []).sort((a, b) => a.s - b.s);
    let cursor = st.from;
    let maxWait = 0;
    for (const p of plays) {
      maxWait = Math.max(maxWait, (p.s - cursor) / 60000);
      cursor = Math.max(cursor, p.e);
    }
    // 진행 중이면 '지금 기다리는 중'도 센다(끝난 정모의 마지막 판 뒤는 그냥 쉬다 간 것이라 안 셈).
    if (!session.endedAt && st.to === endMs && plays.length && !playingNow.has(id)) maxWait = Math.max(maxWait, (endMs - cursor) / 60000);
    if (!plays.length) maxWait = 0; // 0판은 아래 noGames 로 따로
    if (!plays.length && stayedMin >= 30) noGames.push({ name: nameOf.get(id) ?? '?', stayedMin: Math.round(stayedMin) });
    if (maxWait >= 25) longWaits.push({ name: nameOf.get(id) ?? '?', minutes: Math.round(maxWait) });
    if (stayedMin >= 45) rates.push(plays.length / (stayedMin / 60));
  }
  const rateMed = rates.length ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 0;
  for (const id of people) {
    const st = stay.get(id)!;
    const stayedMin = (st.to - st.from) / 60000;
    if (stayedMin < 45) continue;
    const g = gamesOf(id);
    const perHour = g / (stayedMin / 60);
    if (g > 0 && rateMed > 0 && perHour < rateMed * 0.6) fewGames.push({ name: nameOf.get(id) ?? '?', games: g, perHour: Math.round(perHour * 10) / 10 });
  }
  longWaits.sort((a, b) => b.minutes - a.minutes);
  fewGames.sort((a, b) => a.perHour - b.perHour);

  const editCount = (a: string) => edits.find((e) => e.action === a)?._count ?? 0;
  const reasons: Record<string, number> = {};
  for (const f of fb) if (f.reason) reasons[f.reason] = (reasons[f.reason] ?? 0) + 1;
  durs.sort((a, b) => a - b);

  const report: SessionReport = {
    sessionId,
    ended: session.status !== 'ACTIVE',
    minutes: Math.round((endMs - session.startedAt.getTime()) / 60000),
    games: turns.length,
    players: people.length,
    avgGameMin: durs.length ? Math.round(durs[Math.floor(durs.length / 2)] * 10) / 10 : null,
    gamesPerPerson: { min: counts[0] ?? 0, median, max: counts[counts.length - 1] ?? 0 },
    mixedPct: fours ? Math.round((mixed / fours) * 100) : null,
    longWaits: longWaits.slice(0, 8),
    noGames: noGames.slice(0, 8),
    fewGames: fewGames.slice(0, 6),
    sameFourRepeats: Array.from(groupSeen.values()).reduce((a, n) => a + Math.max(0, n - 1), 0),
    ai: {
      games: editCount('KEPT') + editCount('EDITED') + editCount('DELETED'),
      kept: editCount('KEPT'),
      edited: editCount('EDITED'),
      deleted: editCount('DELETED'),
      commands: cmds.length,
      commandsOk: cmds.filter((c) => c.outcome === 'OK').length,
    },
    feedback: {
      total: fb.length,
      good: fb.filter((f) => f.rating === 'GOOD').length,
      ok: fb.filter((f) => f.rating === 'OK').length,
      bad: fb.filter((f) => f.rating === 'BAD').length,
      reasons,
    },
    resultsRecorded: turns.filter((t) => t.winnerIds.length === 2).length,
    summary: null,
  };
  if (withSummary && report.games >= 4) report.summary = await summarize(report).catch(() => null);
  return report;
}

const REASON_KO: Record<string, string> = {
  TOO_HARD: '상대가 너무 셈',
  TOO_EASY: '너무 쉬움',
  UNBALANCED: '팀 실력 차이',
  REPEAT: '같은 사람과 또',
  WAIT: '오래 기다림',
};

async function summarize(r: SessionReport): Promise<string[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  // 판이 늘거나 반응이 생길 때만 새로 쓴다(같은 상태로 다시 열면 그대로).
  const key = `${r.games}|${r.feedback.total}|${r.ended}`;
  const hit = summaryCache.get(r.sessionId);
  if (hit && hit.key === key) return hit.lines;
  const facts = {
    진행분: r.minutes,
    판수: r.games,
    참가자: r.players,
    판당분_중앙값: r.avgGameMin,
    '1인판수': r.gamesPerPerson,
    혼복비율: r.mixedPct,
    오래기다린사람_25분이상: r.longWaits,
    '30분넘게있었는데0판': r.noGames,
    있던시간대비판수적은사람: r.fewGames,
    같은4명다시: r.sameFourRepeats,
    AI판: r.ai,
    회원반응: { ...r.feedback, reasons: Object.fromEntries(Object.entries(r.feedback.reasons).map(([k, v]) => [REASON_KO[k] ?? k, v])) },
    정모끝남: r.ended,
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: [
            '너는 배드민턴 모임 운영진을 돕는 비서다. 아래 JSON(오늘 정모 기록에서 계산한 숫자)만 보고 운영진에게 줄 짧은 요약을 쓴다.',
            '출력: {"lines":["...","...","..."]} — 2~3줄, 각 줄 45자 안팎. 말투는 해요체("~했어요", "~해 보세요")만, "~습니다" 금지.',
            '1줄: 오늘 전체(판수·공평함) 한 줄 평. 진행분이 60분 안 되면 판수가 적다고 평가하지 말 것. 2줄: 챙길 사람(오래 기다림·0판·판수 적음)이 있으면 이름과 함께, 없으면 잘된 점.',
            '3줄: 다음 정모에 해 볼 것 하나(근거가 있을 때만, 없으면 생략).',
            'JSON에 없는 숫자나 사실은 절대 만들지 마라. 사람을 탓하는 말투 금지.',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 300,
    }),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  const lines = JSON.parse(data?.choices?.[0]?.message?.content || '{}')?.lines;
  if (!Array.isArray(lines)) return null;
  const clean = lines.filter((l: any) => typeof l === 'string' && l.trim()).slice(0, 3).map((l: string) => l.trim().slice(0, 80));
  summaryCache.set(r.sessionId, { key, lines: clean });
  return clean;
}

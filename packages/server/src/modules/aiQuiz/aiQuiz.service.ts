/**
 * AI 편성 퀴즈 — 운영진이 직접 짠 판과 그 순간 AI 안(SHADOW)이 달랐던 순간을 문제로 내고,
 * 사람이 고른 쪽을 모임 스타일 학습(clubStyle)의 정답 쌍으로 쓴다.
 *
 * 링크 하나로 로그인 없이 푼다(운영진끼리 공유). 링크에는 모임 id와 그 모임 전용 키(서버 비밀로 만든
 * HMAC)가 들어가, 키 없이 다른 모임 문제를 볼 수 없다. 화면엔 이름 없이 성별·급수·번호만 나간다.
 */
import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { BadRequestError, ForbiddenError } from '../../utils/errors';

const LOOKBACK_DAYS = 90;
const MAX_QUESTIONS = 150;
const LEVELS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// BOTH = 둘 다 괜찮음(이 정도 차이는 상관없음), NEITHER = 둘 다 별로.
export const QUIZ_CHOICES = ['OPERATOR', 'AI', 'BOTH', 'NEITHER'] as const;
// 급수 숫자(F–E는 2단계로 본다 — 운영진 규칙). 팀 힘은 여자 2단계 보정.
const SPREAD_NUM: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 0 };
const POWER_NUM: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

export function quizKey(clubId: string): string {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(`ai-quiz:${clubId}`)
    .digest('hex')
    .slice(0, 16);
}

function checkKey(clubId: unknown, key: unknown): string {
  if (typeof clubId !== 'string' || typeof key !== 'string' || key.length !== 16) throw new ForbiddenError('퀴즈 링크가 올바르지 않아요');
  const a = Buffer.from(key);
  const b = Buffer.from(quizKey(clubId));
  if (!crypto.timingSafeEqual(a, b)) throw new ForbiddenError('퀴즈 링크가 올바르지 않아요');
  return clubId;
}

// 같은 문제는 항상 같은 순서로 보기를 섞는다(새로고침해도 A/B가 바뀌지 않게).
const operatorFirst = (id: string) => crypto.createHash('md5').update(id).digest()[0] % 2 === 0;

const kstDay = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
};

export async function listQuizQuestions(clubIdRaw: unknown, key: unknown) {
  const clubId = checkKey(clubIdRaw, key);
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { name: true } });
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const edits = (
    await prisma.autoMatchEdit.findMany({
      where: { clubId, action: 'SHADOW', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: MAX_QUESTIONS * 2,
    })
  ).filter(
    (e) =>
      e.aiPlayerIds.length === 4 &&
      e.finalPlayerIds.length === 4 &&
      !e.aiPlayerIds.every((id) => e.finalPlayerIds.includes(id)),
  ).slice(0, MAX_QUESTIONS);
  if (!edits.length) return { club: club?.name ?? '', questions: [] };

  const sids = Array.from(new Set(edits.map((e) => e.clubSessionId)));
  const [sessions, turns, checkins, answers] = await Promise.all([
    prisma.clubSession.findMany({ where: { id: { in: sids } }, select: { id: true, startedAt: true } }),
    prisma.courtTurn.findMany({
      where: { clubSessionId: { in: sids }, startedAt: { not: null } },
      select: { clubSessionId: true, startedAt: true, completedAt: true, players: { select: { userId: true } } },
    }),
    prisma.checkIn.findMany({
      where: { clubSessionId: { in: sids } },
      select: { clubSessionId: true, userId: true, checkedInAt: true, checkedOutAt: true },
    }),
    prisma.aiQuizAnswer.findMany({ where: { clubId, editId: { in: edits.map((e) => e.id) } }, select: { editId: true, name: true, choice: true } }),
  ]);
  const uids = Array.from(new Set(checkins.map((c) => c.userId).concat(edits.flatMap((e) => [...e.aiPlayerIds, ...e.finalPlayerIds]))));
  const [profiles, members] = await Promise.all([
    prisma.playerProfile.findMany({ where: { userId: { in: uids } }, select: { userId: true, gender: true, skillLevel: true } }),
    prisma.clubMember.findMany({ where: { clubId, userId: { in: uids } }, select: { userId: true, skillLevel: true } }),
  ]);
  const prof = new Map(profiles.map((p) => [p.userId, p]));
  const lvOf = new Map(members.map((m) => [m.userId, m.skillLevel]));
  const base = (id: string) => {
    const p = prof.get(id);
    const lv = lvOf.get(id) ?? p?.skillLevel ?? null;
    return `${p?.gender === 'F' ? '여' : p?.gender === 'M' ? '남' : '?'}${lv ?? '?'}`;
  };
  const startOf = new Map(sessions.map((s) => [s.id, s.startedAt.getTime()]));
  const gameType = (ids: string[]) => {
    const m = ids.filter((id) => base(id)[0] === '남').length;
    const f = ids.filter((id) => base(id)[0] === '여').length;
    if (f === 0) return '남복';
    if (m === 0) return '여복';
    return m === f ? '혼복' : '혼복 ' + Math.max(m, f) + ':' + Math.min(m, f);
  };

  const questions = edits.map((e) => {
    const T = e.createdAt.getTime() - 1000;
    const sTurns = turns.filter((t) => t.clubSessionId === e.clubSessionId);
    const games = new Map<string, number>();
    const mixed = new Map<string, number>();
    const lastEnd = new Map<string, number>();
    const lastType = new Map<string, { at: number; type: string }>();
    const playingFor = new Map<string, number>();
    const together = new Map<string, number>();
    for (const t of sTurns) {
      const st = t.startedAt!.getTime();
      const en = t.completedAt?.getTime() ?? null;
      if (st < T) {
        const ids = t.players.map((p) => p.userId);
        const type = gameType(ids);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) together.set(pairKey(ids[i], ids[j]), (together.get(pairKey(ids[i], ids[j])) ?? 0) + 1);
          if (type.startsWith('혼복')) mixed.set(ids[i], (mixed.get(ids[i]) ?? 0) + 1);
          if (st > (lastType.get(ids[i])?.at ?? 0)) lastType.set(ids[i], { at: st, type });
        }
      }
      for (const { userId } of t.players) {
        if (en != null && en <= T) {
          games.set(userId, (games.get(userId) ?? 0) + 1);
          if (en > (lastEnd.get(userId) ?? 0)) lastEnd.set(userId, en);
        } else if (st < T) playingFor.set(userId, Math.round((T - st) / 60000));
      }
    }
    const present = checkins.filter(
      (c) => c.clubSessionId === e.clubSessionId && c.checkedInAt.getTime() <= T && (!c.checkedOutAt || c.checkedOutAt.getTime() > T),
    );
    const cin = new Map(present.map((c) => [c.userId, c.checkedInAt.getTime()]));
    const opt = new Set([...e.finalPlayerIds, ...e.aiPlayerIds]);
    const shown = Array.from(new Set([...present.map((c) => c.userId).filter((id) => !playingFor.has(id)), ...opt]));
    shown.sort((a, b) => {
      const [ga, gb] = [base(a)[0], base(b)[0]];
      if (ga !== gb) return ga === '남' ? -1 : 1;
      return LEVELS.indexOf(base(a).slice(1)) - LEVELS.indexOf(base(b).slice(1));
    });
    const seen = new Map<string, number>();
    const label = new Map<string, string>();
    for (const id of shown) {
      const b = base(id);
      const n = (seen.get(b) ?? 0) + 1;
      seen.set(b, n);
      label.set(id, b + CIRCLED[Math.min(n, 20) - 1]);
    }
    const gs = present.map((c) => games.get(c.userId) ?? 0).sort((a, b) => a - b);
    const med = gs.length ? gs[Math.floor((gs.length - 1) / 2)] : 0;
    const stateOf = (id: string) => {
      if (playingFor.has(id)) return `코트에서 치는 중(${playingFor.get(id)}분째)`;
      const rest = (T - Math.max(lastEnd.get(id) ?? 0, cin.get(id) ?? T)) / 60000;
      return rest < 1 ? '방금 끝남' : `${Math.round(rest)}분 쉼`;
    };
    const summarize = (ids: string[]) => {
      const lv = (id: string) => base(id).slice(1);
      const g = (id: string) => base(id)[0];
      const spread = (xs: string[]) => {
        if (xs.length < 2) return null;
        const v = xs.map((id) => SPREAD_NUM[lv(id)] ?? 4);
        const lo = xs[v.indexOf(Math.min(...v))];
        const hi = xs[v.indexOf(Math.max(...v))];
        return { text: g(xs[0]) + ' ' + lv(hi) + (lv(hi) === lv(lo) ? '' : '~' + lv(lo)), gap: Math.max(...v) - Math.min(...v) };
      };
      const men = ids.filter((id) => g(id) === '남');
      const women = ids.filter((id) => g(id) === '여');
      const power = (id: string) => (POWER_NUM[lv(id)] ?? 4) - (g(id) === '여' ? 2 : 0);
      const [a, b, c, d] = ids;
      let splits: [string[], string[]][] = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
      if (men.length === 2 && women.length === 2) splits = splits.filter(([x]) => g(x[0]) !== g(x[1]));
      const best = splits
        .map(([x, y]) => ({ x, y, diff: Math.abs(power(x[0]) + power(x[1]) - power(y[0]) - power(y[1])) }))
        .sort((p, q) => p.diff - q.diff)[0];
      const repeats: string[] = [];
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const n = together.get(pairKey(ids[i], ids[j])) ?? 0;
          if (n > 0) repeats.push(label.get(ids[i]) + '·' + label.get(ids[j]) + ' ' + n + '번');
        }
      const spreads = [spread(men), spread(women)].filter((x): x is { text: string; gap: number } => !!x);
      return {
        type: gameType(ids),
        spread: spreads.map((x) => x.text + (x.gap ? '(' + x.gap + '단계)' : '')).join(' · ') || '-',
        teams: best ? best.x.map((id) => label.get(id)).join('·') + ' vs ' + best.y.map((id) => label.get(id)).join('·') + ' (힘 차이 ' + best.diff + ')' : '-',
        repeats,
        justOrPlaying: ids.filter((id) => playingFor.has(id) || stateOf(id) === '방금 끝남').length,
      };
    };
    const operator = { src: 'OPERATOR', players: e.finalPlayerIds.map((id) => label.get(id)!), summary: summarize(e.finalPlayerIds) };
    const ai = { src: 'AI', players: e.aiPlayerIds.map((id) => label.get(id)!), summary: summarize(e.aiPlayerIds) };
    const options = (operatorFirst(e.id) ? [operator, ai] : [ai, operator]).map((o, i) => ({ ...o, key: 'AB'[i] }));
    const start = startOf.get(e.clubSessionId) ?? T;
    return {
      id: e.id,
      when: `${kstDay(e.createdAt)} 정모 · 시작 ${Math.max(0, Math.round((T - start) / 60000))}분 뒤`,
      context: `출석 ${present.length}명 · 코트에서 치는 중 ${playingFor.size}명 · 판수 중앙값 ${med}판`,
      people: shown.map((id) => ({
        label: label.get(id)!,
        games: games.get(id) ?? 0,
        mixed: mixed.get(id) ?? 0,
        last: lastType.get(id)?.type ?? null,
        state: stateOf(id),
      })),
      options,
      answers: answers.filter((a) => a.editId === e.id).map((a) => ({ name: a.name, choice: a.choice })),
    };
  });
  return { club: club?.name ?? '', questions };
}

export async function saveQuizAnswer(body: any) {
  const clubId = checkKey(body?.c, body?.k);
  const { qid, choice } = body ?? {};
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 20) : '';
  if (!name) throw new BadRequestError('이름을 적어 주세요');
  if (typeof qid !== 'string' || !QUIZ_CHOICES.includes(choice)) throw new BadRequestError('답이 올바르지 않아요');
  const reasons = Array.isArray(body?.reasons) ? body.reasons.filter((r: unknown) => typeof r === 'string').slice(0, 10).map((r: string) => r.slice(0, 40)) : [];
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const edit = await prisma.autoMatchEdit.findFirst({ where: { id: qid, clubId, action: 'SHADOW' }, select: { id: true } });
  if (!edit) throw new BadRequestError('없는 문제예요');
  // 같은 사람이 같은 문제에 다시 답하면 마지막 답만 남긴다.
  await prisma.aiQuizAnswer.deleteMany({ where: { editId: qid, name } });
  await prisma.aiQuizAnswer.create({ data: { clubId, editId: qid, name, choice, reasons, note: note || null } });
  return { ok: true };
}

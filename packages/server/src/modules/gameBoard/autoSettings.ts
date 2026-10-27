import type { AutoMatchSettings } from '@badminton/shared';
import { prisma } from '../../utils/prisma';
import { NotFoundError, ForbiddenError } from '../../utils/errors';

// AI 편성 설정(모임 단위) — 운영판 'AI 편성 설정'에서 운영진이 정하고, 자동 편성 엔진이 읽는다.
// 저장은 Club.autoMatchSettings(JSON), 빈 값은 아래 기본값.

export interface LevelSetting {
  mixedPct: number | null; // 이 급수·성별의 혼복 비율(null = 모임 혼복 비율을 따름)
  up: number | null; // 같은 성별 기준 위로 몇 단계까지 같이(null = 제한 없음)
  down: number | null; // 아래로 몇 단계까지
  games: 'less' | 'normal' | 'more'; // 판수 비중
}
export interface ResolvedAutoSettings {
  levelMatch: 'tight' | 'normal' | 'loose' | 'custom';
  spread2MaxPct: number; // 2단계 차이 판 최대 비율(%) — tight면 0(아예 금지)
  mixedRatio: number;
  avoidRepeat: 'normal' | 'strong';
  gameBalance: 'auto' | 'gap1' | 'gap2' | 'gap3';
  levels: Record<string, LevelSetting>;
}

const LEVEL_DEFAULT: LevelSetting = { mixedPct: null, up: null, down: null, games: 'normal' };
// 여자 F조는 혼복이 정배(운영진 피드백 2026-10-24) — 기본 70%. 운영진이 바꿀 수 있다.
const DEFAULT_LEVELS: Record<string, Partial<LevelSetting>> = { FF: { mixedPct: 70 } };
const SPREAD2_BY_PRESET = { tight: 0, normal: 10, loose: 30 } as const;

export const LEVEL_KEYS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'].flatMap((l) => [`M${l}`, `F${l}`]);

export function resolveAutoSettings(raw: unknown): ResolvedAutoSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as AutoMatchSettings;
  const levelMatch = s.levelMatch ?? 'normal';
  const levels: Record<string, LevelSetting> = {};
  for (const k of LEVEL_KEYS) {
    levels[k] = { ...LEVEL_DEFAULT, ...(DEFAULT_LEVELS[k] ?? {}), ...((s.levels?.[k] as Partial<LevelSetting>) ?? {}) };
  }
  return {
    levelMatch,
    spread2MaxPct: levelMatch === 'custom' ? s.spread2MaxPct ?? 10 : SPREAD2_BY_PRESET[levelMatch],
    mixedRatio: s.mixedRatio ?? 20,
    avoidRepeat: s.avoidRepeat ?? 'normal',
    gameBalance: s.gameBalance ?? 'auto',
    levels,
  };
}

async function clubOfSession(clubSessionId: string, userId: string) {
  const session = await prisma.clubSession.findUnique({ where: { id: clubSessionId }, select: { clubId: true } });
  if (!session) throw new NotFoundError('클럽 세션');
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: session.clubId } },
    select: { role: true },
  });
  if (!member || member.role === 'MEMBER') throw new ForbiddenError('AI 편성 설정은 대표/운영진만 볼 수 있어요');
  return session.clubId;
}

export async function getAutoSettings(clubSessionId: string, userId: string) {
  const clubId = await clubOfSession(clubSessionId, userId);
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { autoMatchSettings: true } });
  return { saved: club?.autoMatchSettings ?? null, resolved: resolveAutoSettings(club?.autoMatchSettings) };
}

export async function saveAutoSettings(clubSessionId: string, userId: string, settings: AutoMatchSettings) {
  const clubId = await clubOfSession(clubSessionId, userId);
  await prisma.club.update({ where: { id: clubId }, data: { autoMatchSettings: settings as object } });
  return { saved: settings, resolved: resolveAutoSettings(settings) };
}

// ─── AI 학습 현황 + 추천 ─────────────────────────────────────────────
// 최근 14일: AI가 짠 판을 운영진이 그대로 썼나/고쳤나/지웠나, 회원 반응, 그리고 그걸 근거로 한
// 설정 추천(한 번 눌러 적용). 학습 자체는 clubStyle(운영진이 고친 판 = 정답 쌍, 가중 학습)이 맡는다.
const SKILL_NUM: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const INSIGHT_DAYS = 14;

export async function getAiInsights(clubSessionId: string, userId: string) {
  const clubId = await clubOfSession(clubSessionId, userId);
  const since = new Date(Date.now() - INSIGHT_DAYS * 24 * 3600 * 1000);
  const [edits, feedback, club] = await Promise.all([
    prisma.autoMatchEdit.findMany({ where: { clubId, createdAt: { gte: since } }, select: { action: true, aiPlayerIds: true, finalPlayerIds: true } }),
    prisma.gameFeedback.findMany({ where: { clubId, createdAt: { gte: since } }, select: { rating: true, reason: true } }),
    prisma.club.findUnique({ where: { id: clubId }, select: { autoMatchSettings: true } }),
  ]);
  const settings = resolveAutoSettings(club?.autoMatchSettings);
  const kept = edits.filter((e) => e.action === 'KEPT').length;
  const edited = edits.filter((e) => e.action === 'EDITED');
  const deleted = edits.filter((e) => e.action === 'DELETED').length;

  // 운영진이 고친 방향 — 급수 폭을 줄였나, 혼복↔남복·여복을 바꿨나.
  const ids = Array.from(new Set(edited.flatMap((e) => [...e.aiPlayerIds, ...e.finalPlayerIds])));
  const [profiles, overrides] = await Promise.all([
    prisma.playerProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, skillLevel: true, gender: true } }),
    prisma.clubMember.findMany({ where: { clubId, userId: { in: ids } }, select: { userId: true, skillLevel: true } }),
  ]);
  const ov = new Map(overrides.map((o) => [o.userId, o.skillLevel] as const));
  const info = new Map(
    profiles.map((p) => [p.userId, { skill: SKILL_NUM[(ov.get(p.userId) ?? p.skillLevel) ?? ''] ?? 4, gender: p.gender }] as const),
  );
  const spreadOf = (g: string[]) => {
    const ps = g.map((id) => info.get(id) ?? { skill: 4, gender: null });
    const f = ps.filter((p) => p.gender === 'F');
    const m = ps.filter((p) => p.gender === 'M');
    const sp = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
    if (f.length === 2 && m.length === 2) return Math.max(sp(m.map((p) => p.skill)), sp(f.map((p) => p.skill)));
    return sp(ps.map((p) => p.skill - (p.gender === 'F' ? 2 : 0)));
  };
  const isMixed = (g: string[]) => g.some((id) => info.get(id)?.gender === 'M') && g.some((id) => info.get(id)?.gender === 'F');
  let tighter = 0;
  let looser = 0;
  let toSame = 0;
  let toMixed = 0;
  for (const e of edited) {
    if (e.finalPlayerIds.length !== 4) continue;
    const d = spreadOf(e.finalPlayerIds) - spreadOf(e.aiPlayerIds);
    if (d < 0) tighter++;
    if (d > 0) looser++;
    const a = isMixed(e.aiPlayerIds);
    const b = isMixed(e.finalPlayerIds);
    if (a && !b) toSame++;
    if (!a && b) toMixed++;
  }

  const fb = { GOOD: 0, OK: 0, BAD: 0 } as Record<string, number>;
  const reasons: Record<string, number> = { TOO_HARD: 0, TOO_EASY: 0, REPEAT: 0, WAIT: 0 };
  for (const f of feedback) {
    fb[f.rating] = (fb[f.rating] ?? 0) + 1;
    if (f.reason) reasons[f.reason] = (reasons[f.reason] ?? 0) + 1;
  }

  // 추천 — 근거(숫자)와 한 번에 적용할 설정 변경.
  const recs: { text: string; why: string; patch: AutoMatchSettings }[] = [];
  if (edited.length >= 5 && tighter >= edited.length * 0.5 && settings.levelMatch !== 'tight')
    recs.push({
      text: "급수 맞추기를 '딱 맞게'로",
      why: `운영진이 AI 판을 고친 ${edited.length}번 중 ${tighter}번은 급수 차이를 줄였어요`,
      patch: { levelMatch: 'tight' },
    });
  if (edited.length >= 5 && toSame >= 3 && toSame >= toMixed * 2 && settings.mixedRatio >= 10)
    recs.push({
      text: `혼복 비율을 ${settings.mixedRatio - 10}%로`,
      why: `운영진이 혼복을 남복·여복으로 바꾼 게 ${toSame}번이에요`,
      patch: { mixedRatio: settings.mixedRatio - 10 },
    });
  if (edited.length >= 5 && toMixed >= 3 && toMixed >= toSame * 2 && settings.mixedRatio <= 40)
    recs.push({
      text: `혼복 비율을 ${settings.mixedRatio + 10}%로`,
      why: `운영진이 남복·여복을 혼복으로 바꾼 게 ${toMixed}번이에요`,
      patch: { mixedRatio: settings.mixedRatio + 10 },
    });
  const fbTotal = feedback.length;
  const levelComplaints = reasons.TOO_HARD + reasons.TOO_EASY;
  if (fbTotal >= 10 && levelComplaints >= fbTotal * 0.15 && settings.levelMatch !== 'tight')
    recs.push({
      text: "급수 맞추기를 '딱 맞게'로",
      why: `회원 반응 ${fbTotal}개 중 ${levelComplaints}개가 '급수가 안 맞았어요'예요`,
      patch: { levelMatch: 'tight' },
    });
  if (fbTotal >= 10 && reasons.REPEAT >= fbTotal * 0.15 && settings.avoidRepeat !== 'strong')
    recs.push({
      text: "같은 사람과 또 치기를 '최대한 피하기'로",
      why: `회원 반응 ${fbTotal}개 중 ${reasons.REPEAT}개가 '같은 사람과 또 쳤어요'예요`,
      patch: { avoidRepeat: 'strong' },
    });
  if (fbTotal >= 10 && reasons.WAIT >= fbTotal * 0.15 && settings.gameBalance === 'auto')
    recs.push({
      text: "게임 수 맞추기를 '2판 차이까지'로",
      why: `회원 반응 ${fbTotal}개 중 ${reasons.WAIT}개가 '너무 오래 기다렸어요'예요`,
      patch: { gameBalance: 'gap2' },
    });
  // 같은 설정을 두 번 추천하지 않게(운영진 수정·회원 반응이 둘 다 '딱 맞게'를 가리킬 때).
  const seen = new Set<string>();
  const uniqueRecs = recs.filter((r) => {
    const k = JSON.stringify(r.patch);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    days: INSIGHT_DAYS,
    ai: { total: edits.length, kept, edited: edited.length, deleted, tighter, looser, toSame, toMixed },
    feedback: { total: fbTotal, ...fb, reasons },
    recommendations: uniqueRecs,
  };
}

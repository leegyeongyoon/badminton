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

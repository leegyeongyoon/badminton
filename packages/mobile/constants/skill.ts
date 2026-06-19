/**
 * Skill level (급수) design tokens.
 *
 * Single source of truth mapping the Prisma `SkillLevel` enum (S/A/B/C/D/E/F)
 * to a Korean label, an accessible distinct color, and a sort order.
 * Used by chips/badges across the app.
 *
 * Labels mirror packages/server/prisma/schema.prisma:
 *   S 선수출신 · A 상 · B 중상 · C 중 · D 중하 · E 초심 · F 왕초심
 * Colors reuse the shared palette (constants/theme) so they stay aligned
 * with the existing skill swatches used in game-board / court screens.
 */
import { palette } from './theme';

export type SkillLevel = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface SkillMeta {
  level: SkillLevel;
  /** Korean label for the level. */
  label: string;
  /** Distinct, accessible color for chips/badges. */
  color: string;
  /** Sort order, strongest (S) first. */
  order: number;
}

export const SKILL_LEVELS: SkillLevel[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

export const SKILL_META: Record<SkillLevel, SkillMeta> = {
  S: { level: 'S', label: '선수출신', color: palette.red600, order: 0 },
  A: { level: 'A', label: '상', color: palette.violet600, order: 1 },
  B: { level: 'B', label: '중상', color: palette.teal600, order: 2 },
  C: { level: 'C', label: '중', color: palette.green500, order: 3 },
  D: { level: 'D', label: '중하', color: palette.amber500, order: 4 },
  E: { level: 'E', label: '초심', color: palette.slate500, order: 5 },
  F: { level: 'F', label: '왕초심', color: palette.slate700, order: 6 },
};

const FALLBACK_META: SkillMeta = {
  level: 'D',
  label: '',
  color: palette.slate400,
  order: 99,
};

/**
 * Returns the metadata for a skill level. Accepts any string (e.g. raw API
 * value) and degrades to a neutral fallback for unknown/empty values.
 */
export function getSkillMeta(level: string | null | undefined): SkillMeta {
  if (!level) return FALLBACK_META;
  const key = level.toUpperCase() as SkillLevel;
  return SKILL_META[key] ?? FALLBACK_META;
}

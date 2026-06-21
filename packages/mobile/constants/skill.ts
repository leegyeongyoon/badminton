/**
 * Skill level (급수) design tokens.
 *
 * Single source of truth mapping the Prisma `SkillLevel` enum (S/A/B/C/D/E/F)
 * to its 급수 criteria (description), an accessible distinct color, and a sort
 * order. Used by chips/badges across the app.
 *
 * IMPORTANT: the old 상/중상/중/중하/초심/왕초심 word-labels are NO LONGER shown
 * in the UI. Displays use the 급수 LETTER (`level`) and, where there's room, the
 * CRITERIA (`description`). A null/unknown 급수 reads as "미설정" (level "—").
 *
 * Criteria mirror packages/server/prisma/schema.prisma:
 *   S 선수출신 · A B조 입상이상 · B C조 입상이상 · C D조 입상이상 ·
 *   D 초심부 입상이상 · E 구력 6개월 이상 · F 구력 6개월 이하
 * Colors reuse the shared palette (constants/theme) so they stay aligned
 * with the existing skill swatches used in game-board / court screens.
 */
import { palette } from './theme';

export type SkillLevel = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface SkillMeta {
  /** 급수 letter (S/A/B/C/D/E/F), or "—" when unset (미설정). */
  level: string;
  /**
   * DEPRECATED for display: the old 상/중상/중/중하/초심/왕초심 word-label.
   * No longer surfaced in the UI — show `level` (letter) and/or `description`
   * (criteria) instead. For the unset fallback this reads "미설정". Kept on the
   * type for backwards compat only.
   */
  label: string;
  /** Detailed 급수 criteria (shown in pickers/displays to help users self-select). */
  description: string;
  /** Distinct, accessible color for chips/badges. */
  color: string;
  /** Sort order, strongest (S) first. */
  order: number;
}

export const SKILL_LEVELS: SkillLevel[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

// Criteria per the club's 급수 standard:
//   S 선수출신 · A B조 입상이상 · B C조 입상이상 · C D조 입상이상 ·
//   D 초심부 입상이상 · E 구력 6개월 이상 · F 구력 6개월 이하
export const SKILL_META: Record<SkillLevel, SkillMeta> = {
  S: { level: 'S', label: '선수출신', description: '선수출신', color: palette.red600, order: 0 },
  A: { level: 'A', label: '상', description: 'B조 입상 이상', color: palette.violet600, order: 1 },
  B: { level: 'B', label: '중상', description: 'C조 입상 이상', color: palette.teal600, order: 2 },
  C: { level: 'C', label: '중', description: 'D조 입상 이상', color: palette.green500, order: 3 },
  D: { level: 'D', label: '중하', description: '초심부 입상 이상', color: palette.amber500, order: 4 },
  E: { level: 'E', label: '초심', description: '구력 6개월 이상', color: palette.slate500, order: 5 },
  F: { level: 'F', label: '왕초심', description: '구력 6개월 이하', color: palette.slate700, order: 6 },
};

/**
 * Neutral meta for a null/unknown 급수 (미설정). Renders as a muted "—" with a
 * "미설정" criteria/label so it NEVER shows a real letter (e.g. "D") or word.
 */
const FALLBACK_META: SkillMeta = {
  level: '—',
  label: '미설정',
  description: '미설정',
  color: palette.slate400,
  order: 99,
};

/**
 * Returns the metadata for a skill level. Accepts any string (e.g. raw API
 * value) and degrades to the neutral "미설정" fallback for unknown/empty values.
 */
export function getSkillMeta(level: string | null | undefined): SkillMeta {
  if (!level) return FALLBACK_META;
  const key = level.toUpperCase() as SkillLevel;
  return SKILL_META[key] ?? FALLBACK_META;
}

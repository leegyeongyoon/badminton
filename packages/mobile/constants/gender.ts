/**
 * Gender (성별) design tokens.
 *
 * Maps the server's `gender` value ('M' | 'F' | null) to an instantly
 * distinguishable marker: blue male / rose female. The marker is rendered as a
 * VECTOR icon (MaterialCommunityIcons gender-male/gender-female via the shared
 * <GenderMarker> component) so it renders identically on every device + font
 * and aligns predictably — never raw ♂/♀ Unicode (which showed as tofu/□ or
 * drifted off-baseline on some mobile fonts). Colors resolve from the theme so
 * they adapt to light/dark, with palette fallbacks for non-themed call sites.
 */
import type { IconName } from '../components/ui/Icon';
import { palette } from './theme';

export type Gender = 'M' | 'F';

export interface GenderMeta {
  gender: Gender;
  /**
   * Unicode gender symbol. KEPT for non-visual uses (a11y labels, logs) but
   * NOT for on-screen markers — render <GenderMarker> / the `icon` instead.
   */
  symbol: string;
  /** Semantic Icon name for the robust vector marker (renders everywhere). */
  icon: IconName;
  /** Korean label. */
  label: string;
  /** Solid marker color (light-theme fallback). */
  color: string;
  /** Soft background tint (light-theme fallback). */
  bg: string;
}

export const GENDER_META: Record<Gender, GenderMeta> = {
  M: { gender: 'M', symbol: '♂', icon: 'genderMale', label: '남', color: palette.blue500, bg: palette.blue50 },
  F: { gender: 'F', symbol: '♀', icon: 'genderFemale', label: '여', color: palette.rose500, bg: palette.rose50 },
};

/**
 * Returns gender metadata, or null for unknown/empty values so callers can
 * skip the marker entirely (guests / members with no profile gender).
 */
export function getGenderMeta(gender: string | null | undefined): GenderMeta | null {
  if (!gender) return null;
  const key = gender.toUpperCase();
  if (key === 'M' || key === 'MALE') return GENDER_META.M;
  if (key === 'F' || key === 'FEMALE') return GENDER_META.F;
  return null;
}

/**
 * Game-type classification by the 4 players' gender composition.
 *  - 남복 (all male) · 여복 (all female) · 혼복 (mixed) · neutral (incomplete/unknown)
 */
export type GameType = 'male' | 'female' | 'mixed' | 'neutral';

export interface GameTypeMeta {
  type: GameType;
  /** Korean badge label (혼복/여복/남복) or empty for neutral. */
  label: string;
  /** Theme color-token keys; resolve against the active theme `colors`. */
  colorKey: 'gameTypeMale' | 'gameTypeFemale' | 'gameTypeMixed' | 'gameTypeNeutral';
  bgKey: 'gameTypeMaleBg' | 'gameTypeFemaleBg' | 'gameTypeMixedBg' | 'gameTypeNeutralBg';
}

const GAME_TYPE_META: Record<GameType, GameTypeMeta> = {
  male: { type: 'male', label: '남복', colorKey: 'gameTypeMale', bgKey: 'gameTypeMaleBg' },
  female: { type: 'female', label: '여복', colorKey: 'gameTypeFemale', bgKey: 'gameTypeFemaleBg' },
  mixed: { type: 'mixed', label: '혼복', colorKey: 'gameTypeMixed', bgKey: 'gameTypeMixedBg' },
  neutral: { type: 'neutral', label: '', colorKey: 'gameTypeNeutral', bgKey: 'gameTypeNeutralBg' },
};

/**
 * Classifies a game from the genders of its (up to 4) players. Returns
 * `neutral` when fewer than 4 known genders are present (incomplete/unknown),
 * so the UI shows a plain accent rather than a misleading 남복/여복/혼복 badge.
 */
export function getGameType(genders: (string | null | undefined)[]): GameTypeMeta {
  const resolved = genders
    .map((g) => getGenderMeta(g)?.gender)
    .filter((g): g is Gender => g === 'M' || g === 'F');
  if (resolved.length < 4) return GAME_TYPE_META.neutral;
  const males = resolved.filter((g) => g === 'M').length;
  if (males === 4) return GAME_TYPE_META.male;
  if (males === 0) return GAME_TYPE_META.female;
  return GAME_TYPE_META.mixed;
}

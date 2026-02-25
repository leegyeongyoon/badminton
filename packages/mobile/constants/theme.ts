/**
 * Design System Tokens
 * Central source of truth for all visual design decisions.
 */
import { Platform } from 'react-native';

// ─── Font Family ───────────────────────────────────────────
export const fontFamily = Platform.select({
  web: "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Noto Sans KR', sans-serif",
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

// ─── Color Palette ──────────────────────────────────────────
export const palette = {
  // Primary - Teal
  teal50: '#F0FDFA',
  teal100: '#CCFBF1',
  teal500: '#14B8A6',
  teal600: '#0D9488',
  teal700: '#0F766E',

  // Legacy Blue (kept for backwards compat)
  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue500: '#3B82F6',
  blue600: '#2563EB',
  blue700: '#1D4ED8',

  // Secondary - Green (Emerald)
  green50: '#ECFDF5',
  green100: '#D1FAE5',
  green500: '#10B981',
  green600: '#059669',

  // Danger - Red
  red50: '#FEF2F2',
  red100: '#FEE2E2',
  red500: '#EF4444',
  red600: '#DC2626',

  // Warning - Amber
  amber50: '#FFFBEB',
  amber100: '#FEF3C7',
  amber200: '#FDE68A',
  amber500: '#F59E0B',
  amber600: '#D97706',
  amber700: '#B45309',
  amber800: '#92400E',
  amber900: '#78350F',

  // Court status - Orange
  orange500: '#F97316',
  orange600: '#EA580C',

  // Info - Violet
  violet50: '#F5F3FF',
  violet100: '#EDE9FE',
  violet200: '#DDD6FE',
  violet500: '#8B5CF6',
  violet600: '#7C3AED',
  violet700: '#6D28D9',

  // Neutrals - Slate
  white: '#FFFFFF',
  slate50: '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',
  black: '#000000',

  // Gray (for maintenance etc.)
  gray500: '#6B7280',
  gray100: '#F3F4F6',
} as const;

// ─── Semantic Light Theme Colors ────────────────────────────
export const lightColors = {
  // Core
  primary: palette.teal600 as string,
  primaryLight: palette.teal100 as string,
  primaryBg: palette.teal50 as string,
  secondary: palette.green500 as string,
  secondaryLight: palette.green100 as string,
  secondaryBg: palette.green50 as string,
  danger: palette.red500 as string,
  dangerLight: palette.red100 as string,
  dangerBg: palette.red50 as string,
  warning: palette.amber500 as string,
  warningLight: palette.amber100 as string,
  warningBg: palette.amber50 as string,
  info: palette.violet600 as string,
  infoLight: palette.violet100 as string,
  infoBg: palette.violet50 as string,

  // Backgrounds
  background: palette.slate50 as string,
  surface: palette.white as string,
  surfaceSecondary: palette.slate100 as string,
  surface2: palette.slate100 as string,
  surface3: palette.slate200 as string,

  // Text
  text: palette.slate800 as string,
  textSecondary: palette.slate500 as string,
  textLight: palette.slate400 as string,
  textInverse: palette.white as string,

  // Borders
  border: palette.slate200 as string,
  divider: palette.slate100 as string,

  // Court status
  courtEmpty: palette.green600 as string,
  courtInGame: palette.orange600 as string,
  courtMaintenance: palette.gray500 as string,

  // Player status
  playerAvailable: palette.green500 as string,
  playerInTurn: palette.red500 as string,
  playerResting: palette.amber500 as string,

  // Timer
  timerSafe: palette.green500 as string,
  timerWarning: palette.amber500 as string,
  timerDanger: palette.red500 as string,

  // Recruitment
  recruitmentBg: '#F0FDF4' as string,

  // Skill levels (legacy)
  skillBeginner: palette.slate400 as string,
  skillIntermediate: palette.teal500 as string,
  skillAdvanced: palette.violet500 as string,
  skillExpert: palette.amber500 as string,

  // Skill levels (S-F)
  skillS: '#DC2626' as string,
  skillA: palette.violet600 as string,
  skillB: palette.teal600 as string,
  skillC: palette.green500 as string,
  skillD: palette.amber500 as string,
  skillE: palette.slate400 as string,
  skillF: palette.slate300 as string,

  // Avatar colors
  avatarColors: [
    palette.teal500, palette.green500, palette.amber500, palette.red500,
    palette.violet500, '#EC4899', '#14B8A6', '#F97316',
  ] as string[],
};

// ─── Dark Theme Colors ──────────────────────────────────────
export const darkColors: typeof lightColors = {
  // Core
  primary: palette.teal500,
  primaryLight: '#134E48',
  primaryBg: '#0D3D38',
  secondary: palette.green500,
  secondaryLight: '#064E3B',
  secondaryBg: '#022C22',
  danger: palette.red500,
  dangerLight: '#7F1D1D',
  dangerBg: '#450A0A',
  warning: palette.amber500,
  warningLight: '#78350F',
  warningBg: '#451A03',
  info: palette.violet500,
  infoLight: '#4C1D95',
  infoBg: '#2E1065',

  // Backgrounds
  background: palette.slate900,
  surface: palette.slate800,
  surfaceSecondary: palette.slate700,
  surface2: palette.slate700,
  surface3: palette.slate600,

  // Text
  text: palette.slate50,
  textSecondary: palette.slate400,
  textLight: palette.slate500,
  textInverse: palette.slate900,

  // Borders
  border: palette.slate700,
  divider: palette.slate700,

  // Court status
  courtEmpty: palette.green500,
  courtInGame: palette.orange500,
  courtMaintenance: palette.slate500,

  // Player status
  playerAvailable: palette.green500,
  playerInTurn: palette.red500,
  playerResting: palette.amber500,

  // Timer
  timerSafe: palette.green500,
  timerWarning: palette.amber500,
  timerDanger: palette.red500,

  // Recruitment
  recruitmentBg: '#052E16',

  // Skill levels (legacy)
  skillBeginner: palette.slate500,
  skillIntermediate: palette.teal500,
  skillAdvanced: palette.violet500,
  skillExpert: palette.amber500,

  // Skill levels (S-F)
  skillS: '#EF4444',
  skillA: palette.violet500,
  skillB: palette.teal500,
  skillC: palette.green500,
  skillD: palette.amber500,
  skillE: palette.slate500,
  skillF: palette.slate400,

  // Avatar colors
  avatarColors: [
    palette.teal500, palette.green500, palette.amber500, palette.red500,
    palette.violet500, '#EC4899', '#14B8A6', '#F97316',
  ],
};

// ─── Typography Scale ───────────────────────────────────────
export const typography = {
  h1: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34, fontFamily },
  h2: { fontSize: 24, fontWeight: '800' as const, lineHeight: 30, fontFamily },
  h3: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26, fontFamily },
  subtitle1: { fontSize: 16, fontWeight: '700' as const, lineHeight: 22, fontFamily },
  subtitle2: { fontSize: 14, fontWeight: '700' as const, lineHeight: 20, fontFamily },
  body1: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24, fontFamily },
  body2: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20, fontFamily },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16, fontFamily },
  overline: { fontSize: 11, fontWeight: '600' as const, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase' as const, fontFamily },
  button: { fontSize: 15, fontWeight: '700' as const, lineHeight: 20, fontFamily },
  buttonSm: { fontSize: 13, fontWeight: '700' as const, lineHeight: 18, fontFamily },
  tabular: Platform.OS === 'web'
    ? { fontVariantNumeric: 'tabular-nums' } as any
    : { fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
} as const;

// ─── Spacing Scale ──────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  smd: 10,
  md: 12,
  mlg: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const;

// ─── Border Radius ──────────────────────────────────────────
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 14,
  xxxl: 16,
  full: 9999,
  // Semantic aliases
  card: 16,
  banner: 20,
  pill: 20,
} as const;

// ─── Opacity Scale ──────────────────────────────────────────
export const opacity = {
  disabled: 0.5,
  subtle: 0.08,
  light: 0.15,
  medium: 0.25,
  border: 0.19,
} as const;

// ─── Shadow Helpers ─────────────────────────────────────────
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const createShadow = (
  offsetY: number,
  blurRadius: number,
  shadowOpacity: number,
  elevation: number,
  color: string = palette.black,
): Record<string, any> => {
  if (Platform.OS === 'web') {
    return { boxShadow: `0px ${offsetY}px ${blurRadius}px ${hexToRgba(color, shadowOpacity)}` };
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity,
    shadowRadius: blurRadius,
    elevation,
  };
};

// ─── Shadows ────────────────────────────────────────────────
export const shadows = {
  sm: createShadow(1, 4, 0.04, 1),
  md: createShadow(2, 8, 0.06, 3),
  lg: createShadow(4, 12, 0.12, 6),
  xl: createShadow(8, 24, 0.15, 10),
  colored: (color: string) => createShadow(4, 8, 0.25, 4, color),
};

// ─── Dark Mode Shadows ──────────────────────────────────────
export const darkShadows = {
  sm: createShadow(1, 4, 0.2, 1),
  md: createShadow(2, 8, 0.3, 3),
  lg: createShadow(4, 12, 0.4, 6),
  xl: createShadow(8, 24, 0.5, 10),
  colored: (color: string) => createShadow(4, 8, 0.4, 4, color),
};

// ─── Combined Theme Object ──────────────────────────────────
export const theme = {
  colors: lightColors,
  typography,
  spacing,
  radius,
  opacity,
  shadows,
} as const;

export type Theme = typeof theme;
export type ThemeColors = typeof lightColors;

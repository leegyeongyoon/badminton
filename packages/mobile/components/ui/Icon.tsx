import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { lightColors } from '../../constants/theme';

/**
 * Semantic icon name → MaterialCommunityIcons mapping.
 * Centralizes all icon decisions in one place.
 */
const ICON_MAP = {
  // Navigation / Tabs
  board: 'clipboard-text-outline',
  activity: 'badminton',
  settings: 'cog-outline',

  // Actions
  checkin: 'qrcode-scan',
  checkout: 'logout-variant',
  register: 'account-plus-outline',
  cancel: 'close-circle-outline',
  complete: 'check-circle-outline',
  extend: 'timer-plus-outline',
  requeue: 'refresh',
  share: 'share-variant-outline',
  edit: 'pencil-outline',
  delete: 'trash-can-outline',
  add: 'plus',
  search: 'magnify',

  // Status
  live: 'circle',
  playing: 'play-circle',
  waiting: 'clock-outline',
  resting: 'coffee-outline',
  available: 'check-circle',
  maintenance: 'wrench-outline',
  warning: 'alert-outline',
  error: 'alert-circle-outline',
  success: 'check-circle-outline',
  info: 'information-outline',

  // Objects
  court: 'badminton',
  club: 'account-group-outline',
  session: 'account-group',
  rotation: 'autorenew',
  penalty: 'alert-outline',
  notification: 'bell-outline',
  stats: 'chart-bar',
  history: 'history',
  timer: 'timer-outline',
  timerPlus: 'timer-plus-outline',
  calendar: 'calendar-outline',
  trophy: 'trophy-outline',

  // Facility
  facility: 'office-building-outline',
  tv: 'monitor',
  qr: 'qrcode',
  camera: 'camera-outline',
  map: 'map-marker-outline',

  // People
  person: 'account-outline',
  people: 'account-multiple-outline',
  admin: 'shield-account-outline',
  leader: 'crown-outline',

  // Misc
  target: 'target',
  star: 'star-outline',
  starFilled: 'star',
  medal: 'medal-outline',
  chevronLeft: 'chevron-left',
  chevronRight: 'chevron-right',
  back: 'chevron-left',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  close: 'close',
  menu: 'menu',
  link: 'link-variant',
  logout: 'logout',
  empty: 'emoticon-neutral-outline',
  folder: 'folder-outline',
  folderOpen: 'folder-open-outline',
  play: 'play',
  stop: 'stop',
  gamepad: 'gamepad-variant-outline',

  // Theme
  darkMode: 'weather-night',
  lightMode: 'white-balance-sunny',
  systemMode: 'cellphone-cog',

  // Skill levels
  beginner: 'shield-outline',
  intermediate: 'star-outline',
  advanced: 'medal-outline',
  expert: 'trophy-outline',
} as const;

export type IconName = keyof typeof ICON_MAP;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}

export function Icon({ name, size = 24, color = lightColors.text, accessibilityLabel }: IconProps) {
  const iconName = ICON_MAP[name];
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no'}
    >
      <MaterialCommunityIcons
        name={iconName as any}
        size={size}
        color={color}
      />
    </View>
  );
}

/** Get the underlying MaterialCommunityIcons name for a semantic icon */
export function getIconName(name: IconName): string {
  return ICON_MAP[name];
}

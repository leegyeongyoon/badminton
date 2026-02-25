import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { Strings } from '../../constants/strings';
import { alpha } from '../../utils/color';
import { Icon } from '../ui/Icon';
import { Card } from '../ui/Card';
import { SectionHeader } from '../ui/SectionHeader';
import { Badge } from '../ui/Badge';
import { Divider } from '../ui/Divider';
import { typography, spacing, radius } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import type { ThemeMode } from '../../contexts/ThemeContext';

interface MenuSectionProps {
  isAdmin: boolean;
  facilityId: string | undefined;
  unreadCount: number;
  onNavigate: (route: string) => void;
}

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: '라이트',
  dark: '다크',
  system: '시스템',
};

const THEME_MODE_ORDER: ThemeMode[] = ['light', 'dark', 'system'];

export function MenuSection({ isAdmin, facilityId, unreadCount, onNavigate }: MenuSectionProps) {
  const { mode, isDark, colors, setThemeMode } = useTheme();

  const cycleThemeMode = () => {
    const currentIndex = THEME_MODE_ORDER.indexOf(mode);
    const nextIndex = (currentIndex + 1) % THEME_MODE_ORDER.length;
    setThemeMode(THEME_MODE_ORDER[nextIndex]);
  };

  const items: Array<{
    key: string;
    icon: 'notification' | 'admin' | 'tv';
    iconColor: string;
    label: string;
    desc?: string;
    route: string;
    badge?: React.ReactNode;
    visible: boolean;
  }> = [
    {
      key: 'notifications',
      icon: 'notification',
      iconColor: colors.danger,
      label: Strings.settings.notifications,
      route: '/notifications',
      badge: unreadCount > 0 ? (
        <Badge label={String(unreadCount)} variant="filled" color="danger" size="sm" />
      ) : undefined,
      visible: true,
    },
    {
      key: 'admin',
      icon: 'admin',
      iconColor: colors.warning,
      label: Strings.settings.admin,
      desc: Strings.settings.adminDesc,
      route: '/admin',
      visible: isAdmin,
    },
    {
      key: 'tv',
      icon: 'tv',
      iconColor: colors.info,
      label: Strings.settings.tvDisplay,
      desc: Strings.settings.tvDisplayDesc,
      route: `/display/${facilityId}`,
      visible: !!facilityId,
    },
  ];

  const visibleItems = items.filter((item) => item.visible);

  return (
    <View style={styles.section}>
      <SectionHeader title="메뉴" />
      <Card variant="elevated" style={styles.card}>
        {/* Dark mode toggle row */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={cycleThemeMode}
          activeOpacity={0.6}
        >
          <View style={[styles.iconCircle, { backgroundColor: alpha(colors.info, 0.12) }]}>
            <Icon
              name={isDark ? 'darkMode' : 'lightMode'}
              size={18}
              color={colors.info}
            />
          </View>
          <View style={styles.menuInfo}>
            <Text style={[styles.menuLabel, { color: colors.text }]}>다크 모드</Text>
            <Text style={[styles.menuDesc, { color: colors.textSecondary }]}>
              {THEME_MODE_LABELS[mode]}
            </Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={(value) => setThemeMode(value ? 'dark' : 'light')}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </TouchableOpacity>

        {visibleItems.map((item) => (
          <React.Fragment key={item.key}>
            <Divider spacing={0} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => onNavigate(item.route)}
              activeOpacity={0.6}
            >
              <View style={[styles.iconCircle, { backgroundColor: alpha(item.iconColor, 0.12) }]}>
                <Icon name={item.icon} size={18} color={item.iconColor} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
                {item.desc && <Text style={[styles.menuDesc, { color: colors.textSecondary }]}>{item.desc}</Text>}
              </View>
              {item.badge}
              <Icon name="chevronRight" size={20} color={colors.textLight} />
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.mlg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuInfo: {
    flex: 1,
  },
  menuLabel: {
    ...typography.body1,
  },
  menuDesc: {
    ...typography.caption,
    marginTop: 2,
  },
});

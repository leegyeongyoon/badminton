import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { Card } from '../ui/Card';
import { SectionHeader } from '../ui/SectionHeader';
import { Divider } from '../ui/Divider';
import { Badge } from '../ui/Badge';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';

interface FacilitySectionProps {
  facilityName: string | undefined;
  checkinStatus: { facilityName: string } | null;
  onChangeFacility: () => void;
  onCheckout: () => void;
}

export function FacilitySection({ facilityName, checkinStatus, onChangeFacility, onCheckout }: FacilitySectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <SectionHeader title={Strings.settings.facility} />
      <Card variant="elevated" style={styles.card}>
        <TouchableOpacity style={styles.menuItem} onPress={onChangeFacility} activeOpacity={0.6}>
          <View style={[styles.iconCircle, { backgroundColor: alpha(colors.primary, 0.12) }]}>
            <Icon name="facility" size={18} color={colors.primary} />
          </View>
          <View style={styles.menuInfo}>
            <Text style={[styles.menuLabel, { color: colors.text }]}>{Strings.facility.change}</Text>
            {facilityName && (
              <Text style={[styles.menuDesc, { color: colors.textSecondary }]} numberOfLines={1}>{facilityName}</Text>
            )}
          </View>
          <Icon name="chevronRight" size={20} color={colors.textLight} />
        </TouchableOpacity>

        {checkinStatus && (
          <>
            <Divider spacing={0} />
            <View style={styles.menuItem}>
              <View style={[styles.iconCircle, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
                <Icon name="qr" size={18} color={colors.secondary} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuLabel, { color: colors.text }]}>{Strings.settings.checkinStatus}</Text>
                <Text style={[styles.menuDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {checkinStatus.facilityName}
                </Text>
              </View>
              <View style={styles.checkinActions}>
                <Badge label={Strings.checkin.checkedIn} variant="filled" color="success" size="sm" />
                <TouchableOpacity style={[styles.checkoutButton, { backgroundColor: colors.dangerLight }]} onPress={onCheckout} activeOpacity={0.7}>
                  <Text style={[styles.checkoutButtonText, { color: colors.danger }]}>체크아웃</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
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
  checkinActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  checkoutButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  checkoutButtonText: {
    ...typography.caption,
    fontWeight: '700',
  },
});

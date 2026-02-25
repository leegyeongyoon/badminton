import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Badge } from '../ui/Badge';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius, opacity } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Strings } from '../../constants/strings';
import { useStagger } from '../../utils/animations';

interface RecruitmentItem {
  id: string;
  gameType: string;
  playersRequired: number;
  status: string;
  members: { userId: string; userName: string }[];
}

interface RecruitmentListProps {
  recruitments: RecruitmentItem[];
}

function RecruitmentCard({ recruitment, index }: { recruitment: RecruitmentItem; index: number }) {
  const { colors } = useTheme();
  const staggerStyle = useStagger(index);

  return (
    <Animated.View style={[styles.card, { backgroundColor: colors.recruitmentBg, borderColor: alpha(colors.secondary, opacity.border) }, staggerStyle]}>
      <View style={styles.header}>
        <Badge
          label={Strings.court.gameType[recruitment.gameType as keyof typeof Strings.court.gameType] || recruitment.gameType}
          variant="filled"
          color="secondary"
        />
        <Text style={[styles.count, { color: colors.secondary }]}>{recruitment.members.length}/{recruitment.playersRequired}</Text>
      </View>
      <Text style={[styles.members, { color: colors.textSecondary }]}>{recruitment.members.map((m) => m.userName).join(', ')}</Text>
    </Animated.View>
  );
}

export function RecruitmentList({ recruitments }: RecruitmentListProps) {
  const { colors } = useTheme();
  if (recruitments.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{Strings.activity.recruitmentActivity}</Text>
      {recruitments.map((r, index) => (
        <RecruitmentCard key={r.id} recruitment={r} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, marginBottom: spacing.xl },
  sectionTitle: { ...typography.h3, marginBottom: spacing.mlg },
  card: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  count: { ...typography.subtitle2 },
  members: { ...typography.body2, marginTop: 2 },
});

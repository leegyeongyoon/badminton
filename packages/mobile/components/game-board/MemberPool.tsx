import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { typography, spacing, radius } from '../../constants/theme';

interface MemberPoolProps {
  members: { userId: string; userName: string; skillLevel?: string; assigned?: boolean }[];
  onMemberPress: (userId: string) => void;
  selectedId?: string | null;
}

const SKILL_COLORS: Record<string, string> = {
  S: '#DC2626', A: '#7C3AED', B: '#0D9488', C: '#10B981',
  D: '#F59E0B', E: '#94A3B8', F: '#CBD5E1',
};

export function MemberPool({ members, onMemberPress, selectedId }: MemberPoolProps) {
  const { colors } = useTheme();

  const available = members.filter((m) => !m.assigned);
  const assigned = members.filter((m) => m.assigned);

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>
        {Strings.gameBoard.memberPool} ({available.length}명)
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {available.map((m) => {
          const isSelected = m.userId === selectedId;
          const skillColor = SKILL_COLORS[m.skillLevel || ''] || colors.textLight;
          return (
            <TouchableOpacity
              key={m.userId}
              style={[
                styles.chip,
                { backgroundColor: colors.surface, borderColor: colors.border },
                isSelected && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
              ]}
              onPress={() => onMemberPress(m.userId)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipName, { color: isSelected ? colors.primary : colors.text }]}>
                {m.userName}
              </Text>
              {m.skillLevel && (
                <Text style={[styles.chipSkill, { color: skillColor }]}>
                  {m.skillLevel}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
        {available.length === 0 && (
          <Text style={[styles.emptyText, { color: colors.textLight }]}>모든 멤버가 배정되었습니다</Text>
        )}
      </ScrollView>
      {assigned.length > 0 && (
        <Text style={[styles.assignedCount, { color: colors.textLight }]}>
          배정됨: {assigned.length}명
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: spacing.md },
  title: { ...typography.subtitle2, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1.5,
  },
  chipName: { ...typography.buttonSm },
  chipSkill: { fontSize: 10, fontWeight: '700' },
  emptyText: { ...typography.caption },
  assignedCount: { ...typography.caption, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
});

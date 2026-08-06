import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

// ─────────────────────────────────────────────────────────────
// Tag — 조용한 정보 뱃지 (마켓·모임 관리의 신뢰 톤 전용).
// 기본은 회색 배경+진회색 글씨. 색은 "상태"일 때만 글자색으로 절제해 사용.
// Badge.tsx(바운스 애니메이션·컬러 필)와 달리 애니메이션 없음.
// ─────────────────────────────────────────────────────────────

type TagVariant = 'neutral' | 'danger' | 'success' | 'primary';

export function Tag({ label, variant = 'neutral' }: { label: string; variant?: TagVariant }) {
  const { colors } = useTheme();
  const text =
    variant === 'danger' ? colors.danger
      : variant === 'success' ? colors.secondary
      : variant === 'primary' ? colors.primary
      : colors.textSecondary;
  const bg =
    variant === 'danger' ? colors.dangerBg
      : variant === 'success' ? colors.secondaryBg
      : variant === 'primary' ? colors.primaryBg
      : colors.surface2;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
});

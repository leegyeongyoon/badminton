import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';

// "준비 중" 티저 — 프로덕션에서 기능 오픈 전까지 노출.
// 어떤 기능인지의 설명은 의도적으로 넣지 않는다(사전 노출 방지).

export function ComingSoon() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '12' }]}>
          <Ionicons name="construct-outline" size={30} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>준비 중입니다</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>새로운 기능을 다듬고 있어요. 곧 만나요!</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xxl, alignItems: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  sub: { fontSize: 13.5, fontWeight: '600', lineHeight: 20, textAlign: 'center', marginTop: spacing.sm },
});

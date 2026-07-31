import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';

// 코치 구인·구직 "준비 중" 티저 — 프로덕션에서 기능 오픈 전까지 노출.
// 탭·화면 구성은 유지한 채 내용만 가려서, 오픈 시 플래그만 켜면 된다.

const PREVIEW = [
  { icon: 'megaphone-outline', text: '클럽·개인이 코치 구인 공고를 올려요' },
  { icon: 'document-text-outline', text: '코치는 경력·자격증·입상 이력서로 지원해요' },
  { icon: 'chatbubble-ellipses-outline', text: '면접 채팅과 오퍼레터로 채용을 확정해요' },
  { icon: 'people-outline', text: '수강생 로스터·출석·대기열까지 앱이 관리해요' },
] as const;

export function ComingSoon() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '12' }]}>
          <Ionicons name="construct-outline" size={30} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>코치 구인·구직, 준비 중입니다</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          배드민턴 코치와 모임을 잇는 채용 서비스를 다듬고 있어요.{'\n'}곧 이 탭에서 만나요!
        </Text>

        <View style={[styles.previewBox, { borderTopColor: colors.border }]}>
          {PREVIEW.map((p) => (
            <View key={p.text} style={styles.previewRow}>
              <Ionicons name={p.icon as never} size={15} color={colors.primary} />
              <Text style={[styles.previewText, { color: colors.textSecondary }]}>{p.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 420, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xxl, alignItems: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  sub: { fontSize: 13.5, fontWeight: '600', lineHeight: 20, textAlign: 'center', marginTop: spacing.sm },
  previewBox: { width: '100%', borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.xl, paddingTop: spacing.lg, gap: spacing.md },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewText: { fontSize: 13, fontWeight: '600', flex: 1, lineHeight: 18 },
});

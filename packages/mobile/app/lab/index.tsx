import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { BackButton } from '../../components/ui/BackButton';
import { Icon, IconName } from '../../components/ui/Icon';

// 실험실 허브 — 최고관리자 전용 상용 기능 프로토타입 모음.
// tint: 카드 좌측 아이콘 타일 색(테마 색 키). 화면 간 시각 구분을 위해 기능마다 다르게.
const CARDS: { key: string; icon: IconName; tint: 'primary' | 'secondary' | 'warning' | 'info'; title: string; desc: string; route: string | null; ready: boolean }[] = [
  { key: 'money', icon: 'stats', tint: 'secondary', title: '회비 관리', desc: '정산(회비·참가비·엔빵·게스트비) · 게스트 · 설정을 한 곳에서', route: '/lab/money', ready: true },
  { key: 'profile', icon: 'trophy', tint: 'primary', title: '내 배드민턴 프로필', desc: '총 게임 · 연속 출석 · 파트너 랭킹 · 성취 뱃지', route: '/lab/profile', ready: true },
  { key: 'lesson', icon: 'court', tint: 'info', title: '레슨 중개', desc: '레슨 개설 · 회원 신청 · 확정 관리', route: '/lab/lessons', ready: true },
];

export default function LabHome() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const tintColor = (t: string) =>
    t === 'primary' ? colors.primary : t === 'secondary' ? colors.secondary : t === 'warning' ? colors.warning : colors.info;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>실험실</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>BETA</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={[styles.notice, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.noticeText, { color: colors.primary }]}>
            최고관리자 전용 — 일반 사용자에게는 보이지 않아요. 상용 기능을 로컬에서 설계·테스트 중입니다.
          </Text>
        </View>
        {CARDS.map((c) => {
          const tc = tintColor(c.tint);
          return (
            <Pressable
              key={c.key}
              disabled={!c.ready}
              onPress={() => c.route && router.push(c.route as any)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.surface },
                shadows.sm,
                pressed && { opacity: 0.88 },
                !c.ready && { opacity: 0.45 },
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: alpha(tc, 0.12) }]}>
                <Icon name={c.icon} size={24} color={tc} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{c.title}</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{c.desc}</Text>
              </View>
              {c.ready
                ? <Icon name="chevronRight" size={20} color={colors.textLight} />
                : <View style={[styles.soonTag, { backgroundColor: colors.surfaceSecondary }]}><Text style={[styles.soonTagText, { color: colors.textLight }]}>준비 중</Text></View>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  notice: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  noticeText: { ...typography.caption, fontWeight: '600', lineHeight: 17 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    marginBottom: spacing.md,
  },
  iconTile: { width: 48, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.subtitle1 },
  cardDesc: { ...typography.caption, marginTop: 3, lineHeight: 16 },
  soonTag: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  soonTagText: { fontSize: 10, fontWeight: '800' },
});

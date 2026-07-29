import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { alpha } from '../utils/color';
import { BackButton } from '../components/ui/BackButton';
import { Icon } from '../components/ui/Icon';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ─────────────────────────────────────────────────────────────
// 모임 찾기 — PUBLIC(공개) 모임 탐색. 카드 탭 → 게스트 신청(모임 미리보기).
// 가입은 여전히 초대코드로만(탐색은 게스트 신청 진입용).
// ─────────────────────────────────────────────────────────────

interface DiscoverClubRow {
  clubId: string;
  name: string;
  description: string | null;
  memberCount: number;
  region: string | null;
  guestFee: number | null;
  duesPeriodType: string;
  scheduleSummary: string | null;
  applyOpen: boolean;
}

export default function Discover() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DiscoverClubRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<string | null>(null); // null = 전체
  const { isAuthenticated } = useAuthStore();

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      // 비로그인(공개 웹)도 탐색 가능 — 공개 엔드포인트(rate-limit) 사용.
      const path = isAuthenticated ? '/clubs/discover' : '/clubs/discover-public';
      const { data } = await api.get(path, { params: q ? { query: q } : {}, _silent: true } as any);
      setRows(data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>모임 찾기</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {/* 검색 */}
        <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name="search" size={18} color={colors.textLight} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query.trim() || undefined)}
            placeholder="모임 이름·소개 검색"
            placeholderTextColor={colors.textLight}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(''); load(); }} hitSlop={8}>
              <Text style={{ color: colors.textLight, fontWeight: '700' }}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* 지역 필터 — 결과에서 파생된 지역 칩 */}
        {(rows ?? []).length > 0 && (() => {
          const regions = [...new Set((rows ?? []).map((c) => c.region).filter(Boolean))] as string[];
          if (regions.length < 2) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
              {[null, ...regions].map((r) => {
                const active = regionFilter === r;
                return (
                  <Pressable
                    key={r ?? '전체'}
                    onPress={() => setRegionFilter(r)}
                    style={[styles.regionChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border }]}
                  >
                    <Text style={[styles.regionChipText, { color: active ? '#fff' : colors.textSecondary }]}>{r ?? '전체'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          );
        })()}

        {loading && rows == null ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (rows ?? []).length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>공개된 모임이 아직 없어요</Text>
            <Text style={[styles.emptySub, { color: colors.textLight }]}>초대코드가 있다면 홈의 '모임 참여'로 가입할 수 있어요</Text>
          </View>
        ) : (
          (rows ?? []).filter((c) => !regionFilter || c.region === regionFilter).map((c) => (
            <Pressable
              key={c.clubId}
              onPress={() => router.push(`/guest-apply?clubId=${c.clubId}` as any)}
              style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, shadows.sm, pressed && { opacity: 0.9 }]}
            >
              <View style={[styles.avatar, { backgroundColor: alpha(colors.primary, 0.12) }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>{c.name[0]}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[styles.cardMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {[c.region, `멤버 ${c.memberCount}명`, c.guestFee != null ? `게스트비 ${c.guestFee.toLocaleString()}원` : null].filter(Boolean).join(' · ')}
                </Text>
                {c.scheduleSummary && (
                  <Text style={[styles.cardMeta, { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{c.scheduleSummary}</Text>
                )}
                {c.description && (
                  <Text style={[styles.cardDesc, { color: colors.textLight }]} numberOfLines={2}>{c.description}</Text>
                )}
              </View>
              <View style={[styles.applyTag, { backgroundColor: c.applyOpen ? colors.primaryBg : colors.surfaceSecondary }]}>
                <Text style={[styles.applyTagText, { color: c.applyOpen ? colors.primary : colors.textLight }]}>
                  {c.applyOpen ? '게스트 신청' : '신청 마감'}
                </Text>
              </View>
            </Pressable>
          ))
        )}
        <Text style={[styles.note, { color: colors.textLight }]}>* 공개로 설정한 모임만 보여요. 모임 가입은 초대코드로만 가능해요.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  center: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.xs },
  emptyTitle: { ...typography.subtitle2 },
  emptySub: { ...typography.caption },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, marginBottom: spacing.md },
  searchInput: { ...typography.body1, flex: 1, paddingVertical: spacing.smd },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.card, marginBottom: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800' },
  cardTitle: { ...typography.subtitle1 },
  cardMeta: { ...typography.caption, marginTop: 2 },
  cardDesc: { ...typography.caption, marginTop: 3, lineHeight: 15 },
  applyTag: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  applyTagText: { fontSize: 11, fontWeight: '800' },
  note: { ...typography.caption, marginTop: spacing.sm, lineHeight: 16 },
  regionChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  regionChipText: { ...typography.body2, fontWeight: '800' },
});

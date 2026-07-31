import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing } from '../constants/theme';
import { BackButton } from '../components/ui/BackButton';
import { coachApi, type CoachCard } from '../services/coach';
import { absolutizeUploadUrl } from '../services/upload';

// ─────────────────────────────────────────────────────────────
// 코치 찾기(숨고식) — 등록 코치 카드 목록. 인증 코치 우선, 지역·검색 필터.
// ─────────────────────────────────────────────────────────────

function priceLabel(c: CoachCard): string | null {
  if (c.pricePerMonth) return `월 ${c.pricePerMonth.toLocaleString()}원`;
  if (c.pricePerSession) return `회당 ${c.pricePerSession.toLocaleString()}원`;
  return null;
}

export default function Coaches() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [coaches, setCoaches] = useState<CoachCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCoaches(await coachApi.list());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 지역 칩은 등록된 코치들의 활동 지역 첫 단어들에서 추출(자유 텍스트라 근사).
  const regionChips = useMemo(() => {
    const set = new Set<string>();
    coaches.forEach((c) => {
      (c.regions || '')
        .split(/[,·/]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => set.add(s.split(/\s+/)[0]));
    });
    return [...set].slice(0, 8);
  }, [coaches]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return coaches.filter((c) => {
      if (region && !(c.regions || '').includes(region)) return false;
      if (!query) return true;
      return [c.displayName, c.intro, c.regions].some((v) => (v || '').toLowerCase().includes(query));
    });
  }, [coaches, q, region]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>코치 찾기</Text>
        <Pressable onPress={() => router.push('/coach/edit' as never)} hitSlop={8}>
          <Text style={[styles.beCoach, { color: colors.primary }]}>코치로 활동하기</Text>
        </Pressable>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textLight} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={q}
            onChangeText={setQ}
            placeholder="코치 이름, 지역 검색"
            placeholderTextColor={colors.textLight}
          />
        </View>
        {regionChips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingTop: spacing.sm }}>
            {regionChips.map((r) => {
              const on = region === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRegion(on ? null : r)}
                  style={[styles.chip, { backgroundColor: on ? colors.primary : colors.background, borderColor: on ? colors.primary : colors.border }]}
                >
                  <Text style={[styles.chipText, { color: on ? '#fff' : colors.textSecondary }]}>{r}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="school-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {coaches.length === 0 ? '아직 등록된 코치가 없어요' : '조건에 맞는 코치가 없어요'}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                레슨 경력이 있다면 첫 코치로 등록해 보세요
              </Text>
              <Pressable onPress={() => router.push('/coach/edit' as never)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.emptyBtnText}>코치로 활동하기</Text>
              </Pressable>
            </View>
          ) : (
            filtered.map((c) => {
              const photo = absolutizeUploadUrl(c.photoUrl);
              const price = priceLabel(c);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/coach/${c.id}` as never)}
                  style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, shadows.md, pressed && { opacity: 0.92 }]}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, styles.photoFallback, { backgroundColor: colors.primary + '14' }]}>
                      <Text style={[styles.photoInitial, { color: colors.primary }]}>{c.displayName.slice(0, 1)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{c.displayName}</Text>
                      {c.certified && (
                        <View style={[styles.certBadge, { backgroundColor: colors.primary + '16' }]}>
                          <Ionicons name="checkmark-circle" size={11} color={colors.primary} />
                          <Text style={[styles.certText, { color: colors.primary }]}>인증</Text>
                        </View>
                      )}
                    </View>
                    {!!c.intro && (
                      <Text style={[styles.intro, { color: colors.textSecondary }]} numberOfLines={1}>{c.intro}</Text>
                    )}
                    <View style={styles.metaRow}>
                      {!!c.regions && (
                        <Text style={[styles.meta, { color: colors.textLight }]} numberOfLines={1}>{c.regions}</Text>
                      )}
                      {c.lessonCount > 0 && (
                        <Text style={[styles.meta, { color: colors.textLight }]}>진행 레슨 {c.lessonCount}</Text>
                      )}
                    </View>
                    {price && <Text style={[styles.price, { color: colors.text }]}>{price}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  beCoach: { fontSize: 13, fontWeight: '800' },
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, ...typography.body2, fontWeight: '600', paddingVertical: 9 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center' },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 18, padding: spacing.lg, marginBottom: spacing.sm + 2 },
  photo: { width: 64, height: 64, borderRadius: 32 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoInitial: { fontSize: 24, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  certBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  certText: { fontSize: 10, fontWeight: '800' },
  intro: { ...typography.body2, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  meta: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  price: { fontSize: 13.5, fontWeight: '800', marginTop: 4 },
});

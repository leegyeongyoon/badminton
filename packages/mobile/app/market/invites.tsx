import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachJobApi, type JobInviteRow } from '../../services/coachJob';
import { showSuccess } from '../../utils/feedback';
import { showConfirm } from '../../utils/alert';
import { ComingSoon } from '../../components/market/ComingSoon';
import { COACH_MARKET_ENABLED } from '../../constants/features';

// ─────────────────────────────────────────────────────────────
// 받은 제안(스카웃) — 공고 측이 내 코치 프로필을 보고 보낸 제안 목록.
// 공고를 확인하고 지원하거나 정중히 거절한다.
// ─────────────────────────────────────────────────────────────

export default function JobInvites() {
  if (!COACH_MARKET_ENABLED) return <ComingSoon />;
  return <JobInvitesInner />;
}

function JobInvitesInner() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<JobInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await coachJobApi.invites());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decline = (r: JobInviteRow) =>
    showConfirm('제안 거절', `"${r.post.title}" 공고의 제안을 정중히 거절할까요?`, async () => {
      if (busy) return;
      setBusy(true);
      try {
        await coachJobApi.declineInvite(r.id);
        showSuccess('제안을 거절했어요');
        await load();
      } catch { /* noop */ } finally {
        setBusy(false);
      }
    }, '거절하기');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>받은 제안</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="mail-open-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 받은 제안이 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                프로필 완성도가 높을수록 공고 측 제안을 받을 확률이 올라가요
              </Text>
            </View>
          ) : (
            rows.map((r) => {
              const declined = r.status === 'DECLINED';
              return (
                <View key={r.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, declined && { opacity: 0.55 }]}>
                  <View style={styles.cardHead}>
                    <View style={[styles.ownerBadge, { backgroundColor: colors.primary + '14' }]}>
                      <Text style={[styles.ownerBadgeText, { color: colors.primary }]}>{r.post.clubName ?? '개인 요청'}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    {declined && <Text style={[styles.stateText, { color: colors.textLight }]}>거절함</Text>}
                    {r.applied && !declined && <Text style={[styles.stateText, { color: colors.secondary }]}>지원함 ✓</Text>}
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>{r.post.title}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {r.post.region} · {r.post.payLabel}
                  </Text>
                  {!!r.message && (
                    <View style={[styles.msgBox, { backgroundColor: colors.primary + '0A', borderColor: colors.primary + '30' }]}>
                      <Text style={[styles.msgText, { color: colors.text }]}>{r.message}</Text>
                    </View>
                  )}
                  {!declined && (
                    <View style={styles.actionRow}>
                      {!r.applied && (
                        <Pressable onPress={() => decline(r)} disabled={busy} style={[styles.ghostBtn, { borderColor: colors.border }]}>
                          <Text style={[styles.ghostText, { color: colors.textSecondary }]}>거절</Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => router.push(`/market/job/${r.post.id}` as never)}
                        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, flex: 2 }, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={styles.primaryText}>{r.applied ? '공고 보기' : '공고 보고 지원하기'}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ownerBadgeText: { fontSize: 11, fontWeight: '800' },
  stateText: { fontSize: 12, fontWeight: '800' },
  cardTitle: { fontSize: 16.5, fontWeight: '800', marginTop: spacing.sm, lineHeight: 23 },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  msgBox: { borderWidth: 1, borderRadius: 12, padding: spacing.md, marginTop: spacing.md },
  msgText: { fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  ghostBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  ghostText: { fontSize: 13.5, fontWeight: '800' },
  primaryBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 12 },
  primaryText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});

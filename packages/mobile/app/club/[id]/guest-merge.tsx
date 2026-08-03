import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { clubApi, type GuestMergeCandidates, type GuestMergeGuest } from '../../../services/club';
import { showSuccess } from '../../../utils/feedback';
import { showConfirm } from '../../../utils/alert';

// ─────────────────────────────────────────────────────────────
// 게스트 기록 연결 — 현장에서 게스트로 참가해 따로 쌓인 체크인·게임 기록을
// 그 사람의 멤버 계정으로 이관한다(출석왕·출석 이력 복구). 운영진 전용.
//  · 동명 후보: 이름이 같은 멤버가 있는 게스트 → 원클릭 연결
//  · 직접 연결: 이름이 다른 게스트는 멤버를 골라 연결
// ─────────────────────────────────────────────────────────────

export default function GuestMerge() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<GuestMergeCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  // 직접 연결: 멤버 선택 시트를 띄울 대상 게스트
  const [pickTarget, setPickTarget] = useState<GuestMergeGuest | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data: res } = await clubApi.getGuestMergeCandidates(clubId);
      setData(res);
    } catch {
      /* 권한 등 오류 토스트는 인터셉터 */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const merge = useCallback(
    (guest: GuestMergeGuest, member: { userId: string; name: string }) => {
      if (!clubId || busy) return;
      showConfirm(
        '기록 연결',
        `게스트 '${guest.name}'의 체크인 ${guest.checkIns}건 · 게임 기록을\n멤버 '${member.name}' 계정으로 옮길까요?\n(되돌릴 수 없어요)`,
        async () => {
          setBusy(true);
          try {
            const { data: r } = await clubApi.mergeGuest(clubId, guest.id, member.userId);
            showSuccess(`${member.name}님에게 연결 완료 — 체크인 ${r.movedCheckIns}건 · 게임 ${r.movedGames}건 이관`);
            setPickTarget(null);
            await load();
          } catch { /* noop */ } finally {
            setBusy(false);
          }
        },
        '연결하기',
      );
    },
    [clubId, busy, load],
  );

  const candidates = data?.candidates ?? [];
  const candidateGuestIds = new Set(candidates.map((c) => c.guest.id));
  const otherGuests = (data?.guests ?? []).filter((g) => !candidateGuestIds.has(g.id));

  const guestMeta = (g: GuestMergeGuest) =>
    `체크인 ${g.checkIns} · 게임 정모 ${g.gameSessions} · ${new Date(g.createdAt).toLocaleDateString()} 생성`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>게스트 기록 연결</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          <Text style={[styles.pageHint, { color: colors.textSecondary }]}>
            앱 없이 게스트로 참가하면 기록이 별도 계정에 쌓여 출석왕에 잡히지 않아요.
            아래에서 게스트 기록을 그 사람의 멤버 계정으로 옮겨 주세요.
          </Text>

          {/* 동명 후보 — 원클릭 */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>동명 멤버 자동 매칭</Text>
          {candidates.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>동명 매칭되는 게스트가 없어요</Text>
          ) : (
            candidates.map(({ member, guest }) => (
              <View key={guest.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    게스트 {guest.name} → {member.name}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.textLight }]} numberOfLines={1}>{guestMeta(guest)}</Text>
                </View>
                <Pressable
                  onPress={() => merge(guest, member)}
                  disabled={busy}
                  style={({ pressed }) => [styles.linkBtn, { backgroundColor: colors.primary }, (pressed || busy) && { opacity: 0.8 }]}
                >
                  <Text style={styles.linkBtnText}>연결</Text>
                </Pressable>
              </View>
            ))
          )}

          {/* 직접 연결 — 이름이 다른 게스트 */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: spacing.xl }]}>직접 연결 (이름이 다른 경우)</Text>
          {otherGuests.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>이 모임 정모에 기록이 남은 다른 게스트가 없어요</Text>
          ) : (
            otherGuests.map((guest) => (
              <View key={guest.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>게스트 {guest.name}</Text>
                  <Text style={[styles.rowMeta, { color: colors.textLight }]} numberOfLines={1}>{guestMeta(guest)}</Text>
                </View>
                <Pressable
                  onPress={() => setPickTarget(guest)}
                  disabled={busy}
                  style={({ pressed }) => [styles.linkBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }, (pressed || busy) && { opacity: 0.8 }]}
                >
                  <Text style={[styles.linkBtnText, { color: colors.primary }]}>멤버 선택</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 멤버 선택 시트 */}
      <Modal visible={!!pickTarget} transparent animationType="fade" onRequestClose={() => setPickTarget(null)}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setPickTarget(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                '{pickTarget?.name}' 기록을 누구에게 연결할까요?
              </Text>
              <TouchableOpacity onPress={() => setPickTarget(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(data?.members ?? []).map((m) => (
                <Pressable
                  key={m.userId}
                  onPress={() => pickTarget && merge(pickTarget, m)}
                  style={({ pressed }) => [styles.memberRow, { borderBottomColor: colors.border }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.memberName, { color: colors.text }]}>{m.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
                </Pressable>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageHint: { ...typography.caption, lineHeight: 18, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 12.5, fontWeight: '800', marginBottom: spacing.sm },
  empty: { ...typography.caption, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.sm },
  rowName: { fontSize: 14.5, fontWeight: '800' },
  rowMeta: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  linkBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 10 },
  linkBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.xl },
  sheet: { borderRadius: 18, padding: spacing.lg, maxWidth: 480, width: '100%', alignSelf: 'center' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sheetTitle: { ...typography.subtitle1, flex: 1 },
  memberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  memberName: { fontSize: 14.5, fontWeight: '700' },
});

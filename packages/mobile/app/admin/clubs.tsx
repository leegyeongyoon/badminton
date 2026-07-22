import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import { adminStatsApi, type AdminClubRow } from '../../services/adminStats';

// 모임 멤버 역할 라벨 — 모임 상세(club/[id])와 동일.
const ROLE_LABEL: Record<string, string> = { LEADER: '대표', STAFF: '운영진', MEMBER: '회원' };

/**
 * 최고관리자용 "모임별 멤버" 로스터.
 * 각 모임을 탭하면 누가 가입했는지(이름·역할·게스트) 펼쳐 본다.
 * 멤버 많은 모임이 위로, 멤버는 대표→운영진→회원 순(서버 정렬).
 */
export default function AdminClubsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [clubs, setClubs] = useState<AdminClubRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setErrored(false);
      const data = await adminStatsApi.getClubs();
      setClubs(data);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalMembers = clubs?.reduce((s, c) => s + c.memberCount, 0) ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.topBarTitle, { color: colors.text }]}>모임별 멤버 (최고관리자)</Text>
      </View>

      {loading && !clubs ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : errored && !clubs ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>모임 목록을 불러오지 못했어요</Text>
          <Text onPress={load} style={{ color: colors.primary, marginTop: 8, fontWeight: '700' }}>다시 시도</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 48 }}
          refreshControl={Platform.OS === 'ios' ? <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} /> : undefined}
        >
          <Text style={[styles.summary, { color: colors.textSecondary }]}>
            총 {clubs?.length ?? 0}개 모임 · 멤버 {totalMembers}명
          </Text>

          {(clubs ?? []).map((club) => {
            const open = !!expanded[club.id];
            return (
              <View key={club.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable
                  style={styles.clubHead}
                  onPress={() => setExpanded((e) => ({ ...e, [club.id]: !e[club.id] }))}
                  accessibilityLabel={`${club.name} 멤버 ${open ? '접기' : '펼치기'}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.clubName, { color: colors.text }]} numberOfLines={1}>{club.name}</Text>
                    <Text style={[styles.clubMeta, { color: colors.textLight }]}>초대코드 {club.inviteCode}</Text>
                  </View>
                  <View style={[styles.countPill, { backgroundColor: colors.primaryBg }]}>
                    <Text style={[styles.countPillText, { color: colors.primary }]}>{club.memberCount}명</Text>
                  </View>
                  <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} color={colors.textLight} />
                </Pressable>

                {open && (
                  <View style={[styles.memberList, { borderTopColor: colors.divider }]}>
                    {club.members.length === 0 ? (
                      <Text style={[styles.emptyM, { color: colors.textLight }]}>멤버가 없어요</Text>
                    ) : (
                      club.members.map((m) => (
                        <View key={m.userId} style={styles.memberRow}>
                          <View style={[styles.avatar, { backgroundColor: colors.surfaceSecondary }]}>
                            <Text style={[styles.avatarText, { color: colors.textSecondary }]}>{m.name?.[0] ?? '?'}</Text>
                          </View>
                          <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{m.name}</Text>
                          {m.isGuest && (
                            <View style={[styles.tag, { backgroundColor: colors.warningBg }]}>
                              <Text style={[styles.tagText, { color: colors.warning }]}>게스트</Text>
                            </View>
                          )}
                          <View style={[styles.roleTag, {
                            backgroundColor: m.role === 'LEADER' ? colors.warning + '20' : m.role === 'STAFF' ? '#7C3AED20' : colors.divider,
                          }]}>
                            <Text style={[styles.roleTagText, {
                              color: m.role === 'LEADER' ? colors.warning : m.role === 'STAFF' ? '#7C3AED' : colors.textSecondary,
                            }]}>{ROLE_LABEL[m.role] ?? m.role}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {(clubs?.length ?? 0) === 0 && (
            <Text style={[styles.emptyM, { color: colors.textLight, textAlign: 'center', marginTop: 40 }]}>아직 모임이 없어요</Text>
          )}
        </ScrollView>
      )}
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
  topBarTitle: { ...typography.subtitle1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  summary: { ...typography.body2, marginBottom: spacing.md },

  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  clubHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  clubName: { ...typography.subtitle1 },
  clubMeta: { ...typography.caption, marginTop: 2 },
  countPill: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill },
  countPillText: { ...typography.caption, fontWeight: '800' },

  memberList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800' },
  memberName: { ...typography.body2, flex: 1, fontWeight: '600' },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm },
  tagText: { fontSize: 10, fontWeight: '800' },
  roleTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  roleTagText: { fontSize: 11, fontWeight: '800' },
  emptyM: { ...typography.body2, paddingVertical: spacing.sm },
});

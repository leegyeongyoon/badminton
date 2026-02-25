import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  SafeAreaView, ActivityIndicator, Animated as RNAnimated, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameBoard } from '../hooks/useGameBoard';
import { useTheme } from '../hooks/useTheme';
import { useCheckinStore } from '../store/checkinStore';
import { Icon } from '../components/ui/Icon';
import api from '../services/api';
import { showAlert, showConfirm } from '../utils/alert';
import { showSuccess } from '../utils/feedback';
import { typography, spacing, radius, palette } from '../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SKILL_COLORS: Record<string, string> = {
  S: '#DC2626', A: '#7C3AED', B: '#0D9488', C: '#10B981',
  D: '#F59E0B', E: '#94A3B8', F: '#CBD5E1',
};

interface Player {
  userId: string;
  userName: string;
  skillLevel?: string;
  status: string;
}

export default function GameBoardScreen() {
  const router = useRouter();
  const { clubSessionId, clubName } = useLocalSearchParams<{
    clubSessionId: string;
    clubName?: string;
  }>();
  const { colors, shadows } = useTheme();
  const { status: checkinStatus } = useCheckinStore();
  const facilityId = checkinStatus?.facilityId;

  const {
    board, loading, error,
    createBoard, loadBoard,
    addEntry, deleteEntry, pushEntry, pushAll,
  } = useGameBoard(clubSessionId);

  const [courts, setCourts] = useState<{ id: string; name: string; status: string }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [dedicatedCourtIds, setDedicatedCourtIds] = useState<Set<string>>(new Set());

  // Staging
  const [staged, setStaged] = useState<string[]>([]);
  const bounceAnims = useRef([0, 1, 2, 3].map(() => new RNAnimated.Value(1))).current;

  // Load data
  useEffect(() => {
    if (!facilityId) return;
    Promise.all([
      api.get(`/facilities/${facilityId}/courts`).then(({ data }) =>
        setCourts((data || []).filter((c: any) => c.status !== 'MAINTENANCE')),
      ),
      api.get(`/facilities/${facilityId}/players`).then(({ data }) =>
        setPlayers(data || []),
      ),
    ]).catch(() => {});
  }, [facilityId]);

  // Load dedicated courts from club session
  useEffect(() => {
    if (!clubSessionId) return;
    api.get(`/club-sessions/${clubSessionId}`).then(({ data }) => {
      if (data?.courtIds) setDedicatedCourtIds(new Set(data.courtIds));
    }).catch(() => {});
  }, [clubSessionId]);

  useEffect(() => {
    if (!board && !loading && clubSessionId && !error) {
      createBoard().catch(() => {});
    }
  }, [board, loading, clubSessionId, error]);

  const assignedPlayerIds = useMemo(
    () => new Set((board?.entries || []).flatMap((e) => e.playerIds)),
    [board],
  );

  const playingEntries = useMemo(
    () => (board?.entries || []).filter((e) => e.status === 'PLAYING' || e.status === 'MATERIALIZED'),
    [board],
  );
  const queuedEntries = useMemo(
    () => (board?.entries || []).filter((e) => e.status === 'QUEUED').sort((a, b) => a.position - b.position),
    [board],
  );
  const playingByCourtId = useMemo(() => {
    const map = new Map<string, (typeof playingEntries)[0]>();
    for (const entry of playingEntries) if (entry.courtId) map.set(entry.courtId, entry);
    return map;
  }, [playingEntries]);

  const allMembers = useMemo(
    () => players.filter((p) => p.status === 'AVAILABLE' || assignedPlayerIds.has(p.userId)),
    [players, assignedPlayerIds],
  );

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.userId, p);
    return map;
  }, [players]);

  const getPlayer = useCallback((id: string) => playerMap.get(id), [playerMap]);

  // 추천 코트 수: 12명당 1코트
  const recommendedCourts = useMemo(
    () => Math.floor(allMembers.length / 12),
    [allMembers],
  );

  // 전용 코트 목록
  const dedicatedCourts = useMemo(
    () => courts.filter((c) => dedicatedCourtIds.has(c.id)),
    [courts, dedicatedCourtIds],
  );

  // NameSkill
  const NameSkill = useCallback(({ userId, style }: { userId: string; style?: any }) => {
    const p = playerMap.get(userId);
    if (!p) return <Text style={style}>?</Text>;
    const skillColor = SKILL_COLORS[p.skillLevel || ''] || colors.textLight;
    return (
      <Text style={style} numberOfLines={1}>
        {p.userName}
        {p.skillLevel ? <Text style={{ color: skillColor, fontWeight: '800' }}>{p.skillLevel}</Text> : null}
      </Text>
    );
  }, [playerMap, colors.textLight]);

  // ─── Court toggle ───────────────────────
  const toggleCourt = useCallback(async (courtId: string) => {
    const next = new Set(dedicatedCourtIds);
    if (next.has(courtId)) next.delete(courtId);
    else next.add(courtId);

    setDedicatedCourtIds(next);
    try {
      await api.patch(`/club-sessions/${clubSessionId}/courts`, {
        courtIds: Array.from(next),
      });
    } catch (err: any) {
      // Revert on error
      setDedicatedCourtIds(dedicatedCourtIds);
      showAlert('오류', err.response?.data?.error || '코트 설정 실패');
    }
  }, [clubSessionId, dedicatedCourtIds]);

  // ─── Staging ────────────────────────────
  const toggleStaged = useCallback((userId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStaged((prev) => {
      if (prev.includes(userId)) return prev.filter((id) => id !== userId);
      if (prev.length >= 4) return prev;
      const nextIdx = prev.length;
      if (nextIdx < 4) {
        bounceAnims[nextIdx].setValue(0.5);
        RNAnimated.spring(bounceAnims[nextIdx], {
          toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
        }).start();
      }
      return [...prev, userId];
    });
  }, [bounceAnims]);

  const clearStaged = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStaged([]);
  }, []);

  // ─── 대기 등록 ──────────────────────────
  const handleSubmit = useCallback(async () => {
    if (staged.length !== 4) { showAlert('알림', '4명을 선택해주세요'); return; }
    try {
      await addEntry(staged);
      loadBoard();
      showSuccess('대기 등록!');
      setStaged([]);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '등록 실패');
    }
  }, [staged, addEntry, loadBoard]);

  // ─── 다음 게임 투입 (첫 대기 → 첫 빈 전용코트) ─
  const handleNextGame = useCallback(async () => {
    if (queuedEntries.length === 0) {
      showAlert('알림', '대기 중인 게임이 없습니다');
      return;
    }
    // Find first available dedicated court
    const availableCourt = dedicatedCourts.find((c) => !playingByCourtId.has(c.id));
    if (!availableCourt) {
      showAlert('알림', '빈 전용 코트가 없습니다. 게임이 끝나면 투입하세요.');
      return;
    }
    const entry = queuedEntries[0];
    try {
      await pushEntry(entry.id, availableCourt.id);
      loadBoard();
      showSuccess(`${availableCourt.name}에 투입!`);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '투입 실패');
    }
  }, [queuedEntries, dedicatedCourts, playingByCourtId, pushEntry, loadBoard]);

  // ─── 특정 코트에 투입 ──────────────────
  const handlePushToCourt = useCallback(async (courtId: string) => {
    if (queuedEntries.length === 0) {
      showAlert('알림', '대기 중인 게임이 없습니다');
      return;
    }
    const entry = queuedEntries[0];
    const court = courts.find((c) => c.id === courtId);
    showConfirm(
      '코트 투입',
      `대기 1번을 ${court?.name || '코트'}에 투입할까요?`,
      async () => {
        try {
          await pushEntry(entry.id, courtId);
          loadBoard();
          showSuccess(`${court?.name}에 투입!`);
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '투입 실패');
        }
      },
    );
  }, [queuedEntries, courts, pushEntry, loadBoard]);

  const handleDelete = useCallback(
    (entryId: string) =>
      showConfirm('삭제', '이 게임을 삭제할까요?', async () => {
        try {
          await deleteEntry(entryId);
          loadBoard();
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '삭제 실패');
        }
      }),
    [deleteEntry, loadBoard],
  );

  if (loading && !board) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator style={{ marginTop: 100 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  const stagedSet = new Set(staged);
  const hasDedicated = dedicatedCourts.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ──── Header ──── */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Icon name="back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {clubName || ''} 모임판
        </Text>
        {queuedEntries.length > 0 && hasDedicated && (
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.primary }]}
            onPress={handleNextGame}
          >
            <Text style={styles.headerBtnText}>다음 게임 투입</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>

        {/* ═══ Section 1: 모임 코트 설정 ═══ */}
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.sectionBar, { backgroundColor: palette.violet600 }]}>
            <Text style={styles.sectionBarText}>모임 코트</Text>
            <Text style={[styles.sectionBarSub]}>
              {allMembers.length}명 → 추천 {recommendedCourts}코트
            </Text>
          </View>

          <View style={styles.courtSetup}>
            {courts.map((court) => {
              const isDedicated = dedicatedCourtIds.has(court.id);
              const playing = playingByCourtId.get(court.id);
              return (
                <View key={court.id} style={styles.courtSetupItem}>
                  <TouchableOpacity
                    style={[
                      styles.courtToggle,
                      { borderColor: isDedicated ? colors.primary : colors.border },
                      isDedicated && { backgroundColor: colors.primaryLight },
                    ]}
                    onPress={() => toggleCourt(court.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[
                      styles.courtToggleCheck,
                      { backgroundColor: isDedicated ? colors.primary : colors.border },
                    ]}>
                      {isDedicated && <Text style={styles.courtToggleCheckIcon}>✓</Text>}
                    </View>
                    <Text style={[
                      styles.courtToggleName,
                      { color: isDedicated ? colors.primary : colors.text },
                    ]}>
                      {court.name}
                    </Text>
                  </TouchableOpacity>

                  {/* 전용 코트에 현재 게임 표시 */}
                  {isDedicated && (
                    <View style={[styles.courtStatus, { borderColor: colors.border }]}>
                      {playing ? (
                        <>
                          <View style={[styles.courtStatusDot, { backgroundColor: colors.courtInGame }]} />
                          <View style={styles.courtStatusPlayers}>
                            {playing.playerIds.map((pId, i) => (
                              <NameSkill key={pId} userId={pId} style={[styles.courtStatusName, { color: colors.text }]} />
                            ))}
                          </View>
                        </>
                      ) : (
                        <TouchableOpacity
                          style={styles.courtEmptyAction}
                          onPress={() => handlePushToCourt(court.id)}
                          disabled={queuedEntries.length === 0}
                        >
                          <Text style={[
                            styles.courtEmptyText,
                            { color: queuedEntries.length > 0 ? colors.primary : colors.textLight },
                          ]}>
                            {queuedEntries.length > 0 ? '탭하여 다음 게임 투입' : '비어있음'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {!hasDedicated && allMembers.length >= 12 && (
            <Text style={[styles.courtHint, { color: colors.warning }]}>
              코트를 선택하여 모임 전용으로 지정하세요
            </Text>
          )}
          {allMembers.length > 0 && allMembers.length < 12 && (
            <Text style={[styles.courtHint, { color: colors.textSecondary }]}>
              12명 이상이면 전용 코트를 사용할 수 있어요 (현재 {allMembers.length}명)
            </Text>
          )}
        </View>

        {/* ═══ Section 2: 대기 명단 ═══ */}
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.sectionBar, { backgroundColor: colors.warning }]}>
            <Text style={styles.sectionBarText}>대기 명단 ({queuedEntries.length}조)</Text>
          </View>

          {queuedEntries.length === 0 ? (
            <View style={styles.emptyQueue}>
              <Text style={[styles.emptyQueueText, { color: colors.textLight }]}>
                아래 회원을 탭하여 4명씩 조를 편성하세요
              </Text>
            </View>
          ) : (
            queuedEntries.map((entry, idx) => (
              <View key={entry.id} style={[styles.qRow, { borderBottomColor: colors.divider }]}>
                <View style={[styles.qNum, { backgroundColor: idx === 0 ? colors.primary : colors.primaryLight }]}>
                  <Text style={[styles.qNumText, { color: idx === 0 ? '#fff' : colors.primary }]}>{idx + 1}</Text>
                </View>
                <View style={styles.qPlayers}>
                  {entry.playerIds.map((pId, i) => (
                    <NameSkill key={pId} userId={pId} style={[styles.qPlayerText, { color: colors.text }]} />
                  ))}
                </View>
                {idx === 0 && hasDedicated && (
                  <View style={[styles.qNextBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.qNextBadgeText}>다음</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.qBtn, { backgroundColor: colors.danger }]}
                  onPress={() => handleDelete(entry.id)}
                >
                  <Text style={styles.qBtnText}>삭제</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* ═══ Section 3: 출석 회원 ═══ */}
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.sectionBar, { backgroundColor: colors.info }]}>
            <Text style={styles.sectionBarText}>출석 회원 ({allMembers.length}명)</Text>
          </View>
          <View style={styles.memberGrid}>
            {allMembers.map((m) => {
              const isAssigned = assignedPlayerIds.has(m.userId);
              const isStaged = stagedSet.has(m.userId);
              const skillColor = SKILL_COLORS[m.skillLevel || ''] || colors.textLight;
              const canTap = !isAssigned || isStaged;

              return (
                <TouchableOpacity
                  key={m.userId}
                  style={[
                    styles.mChip,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    isAssigned && !isStaged && styles.mChipAssigned,
                    isStaged && { borderColor: colors.primary, backgroundColor: colors.primaryLight, borderWidth: 2 },
                  ]}
                  onPress={() => canTap && toggleStaged(m.userId)}
                  activeOpacity={canTap ? 0.6 : 1}
                >
                  {isStaged && (
                    <View style={[styles.mChipCheck, { backgroundColor: colors.primary }]}>
                      <Text style={styles.mChipCheckText}>{staged.indexOf(m.userId) + 1}</Text>
                    </View>
                  )}
                  <Text
                    style={[styles.mChipName, { color: isStaged ? colors.primary : isAssigned ? colors.textLight : colors.text }]}
                    numberOfLines={1}
                  >
                    {m.userName}
                    {m.skillLevel && (
                      <Text style={{ color: isAssigned && !isStaged ? colors.textLight : skillColor, fontWeight: '800', fontSize: 12 }}>
                        {m.skillLevel}
                      </Text>
                    )}
                  </Text>
                  {isAssigned && !isStaged && (
                    <Text style={[styles.mChipBadge, { color: colors.courtInGame }]}>●</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ height: 130 }} />
      </ScrollView>

      {/* ══════ Fixed Bottom: 게임 편성 트레이 ══════ */}
      <View style={[styles.tray, { backgroundColor: colors.surface, borderTopColor: colors.border }, shadows.lg]}>
        <View style={styles.traySlots}>
          {[0, 1, 2, 3].map((i) => {
            const pId = staged[i];
            const p = pId ? getPlayer(pId) : null;
            const skillColor = p?.skillLevel ? SKILL_COLORS[p.skillLevel] || colors.textLight : colors.textLight;
            return (
              <RNAnimated.View
                key={i}
                style={[
                  styles.traySlot,
                  {
                    borderColor: p ? colors.primary : colors.border,
                    backgroundColor: p ? colors.primaryLight : colors.background,
                    transform: [{ scale: bounceAnims[i] }],
                  },
                ]}
              >
                {p ? (
                  <TouchableOpacity style={styles.traySlotInner} onPress={() => toggleStaged(pId!)} activeOpacity={0.6}>
                    <Text style={[styles.traySlotName, { color: colors.primary }]} numberOfLines={1}>
                      {p.userName}
                      <Text style={{ color: skillColor, fontWeight: '800', fontSize: 10 }}>{p.skillLevel || ''}</Text>
                    </Text>
                    <Text style={[styles.traySlotX, { color: colors.danger }]}>×</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.traySlotEmpty, { color: colors.textLight }]}>{i + 1}</Text>
                )}
              </RNAnimated.View>
            );
          })}
        </View>

        <View style={styles.trayBottom}>
          {staged.length > 0 && (
            <TouchableOpacity style={[styles.trayClearBtn, { borderColor: colors.border }]} onPress={clearStaged}>
              <Text style={[styles.trayClearText, { color: colors.textSecondary }]}>초기화</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.traySubmitBtn, { backgroundColor: staged.length === 4 ? colors.primary : colors.textLight }]}
            onPress={handleSubmit}
            disabled={staged.length !== 4}
          >
            <Text style={styles.traySubmitText}>
              대기 등록{staged.length > 0 && staged.length < 4 ? ` (${staged.length}/4)` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, gap: spacing.md,
  },
  headerTitle: { ...typography.subtitle1, flex: 1 },
  headerBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  headerBtnText: { color: palette.white, ...typography.buttonSm },

  body: { flex: 1 },
  bodyContent: { padding: spacing.md, gap: spacing.md },

  section: { borderRadius: radius.card, overflow: 'hidden' },
  sectionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  sectionBarText: { color: palette.white, ...typography.subtitle2 },
  sectionBarSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },

  // Court setup
  courtSetup: { padding: spacing.md, gap: spacing.sm },
  courtSetupItem: { gap: spacing.xs },
  courtToggle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    borderRadius: radius.lg, borderWidth: 1.5,
  },
  courtToggleCheck: {
    width: 20, height: 20, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  courtToggleCheckIcon: { color: '#fff', fontSize: 13, fontWeight: '800' },
  courtToggleName: { ...typography.subtitle2 },
  courtStatus: {
    marginLeft: 32, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderLeftWidth: 2, gap: 3,
  },
  courtStatusDot: { width: 6, height: 6, borderRadius: 3, marginBottom: 2 },
  courtStatusPlayers: { gap: 1 },
  courtStatusName: { fontSize: 13 },
  courtEmptyAction: { paddingVertical: spacing.xs },
  courtEmptyText: { fontSize: 12, fontWeight: '600' },
  courtHint: { ...typography.caption, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },

  // Queue
  emptyQueue: { paddingVertical: spacing.xl, alignItems: 'center' },
  emptyQueueText: { ...typography.caption },
  qRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.smd, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.sm,
  },
  qNum: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  qNumText: { fontSize: 13, fontWeight: '800' },
  qPlayers: { flex: 1, gap: 1 },
  qPlayerText: { fontSize: 13 },
  qNextBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  qNextBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  qBtn: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.sm },
  qBtnText: { color: palette.white, fontSize: 11, fontWeight: '700' },

  // Members
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
  mChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.smd, paddingVertical: 7,
    borderRadius: radius.pill, borderWidth: 1.5,
  },
  mChipAssigned: { opacity: 0.4 },
  mChipCheck: {
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', marginRight: 2,
  },
  mChipCheckText: { color: palette.white, fontSize: 9, fontWeight: '800' },
  mChipName: { fontSize: 13, fontWeight: '600' },
  mChipBadge: { fontSize: 6, marginLeft: 1 },

  // Tray
  tray: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopWidth: 1,
    paddingTop: spacing.smd,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.md,
    paddingHorizontal: spacing.md, gap: spacing.sm,
  },
  traySlots: { flexDirection: 'row', gap: spacing.sm },
  traySlot: {
    flex: 1, height: 44, borderRadius: radius.lg,
    borderWidth: 1.5, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  traySlotInner: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6 },
  traySlotName: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  traySlotX: { fontSize: 14, fontWeight: '700', marginLeft: 2 },
  traySlotEmpty: { fontSize: 14, fontWeight: '600' },
  trayBottom: { flexDirection: 'row', gap: spacing.xs, justifyContent: 'flex-end' },
  trayClearBtn: {
    paddingHorizontal: spacing.smd, paddingVertical: 6,
    borderRadius: radius.md, borderWidth: 1,
  },
  trayClearText: { fontSize: 12, fontWeight: '600' },
  traySubmitBtn: { paddingHorizontal: spacing.xl, paddingVertical: 7, borderRadius: radius.md },
  traySubmitText: { color: palette.white, fontSize: 13, fontWeight: '700' },
});

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

  // Staging: 4명 모으기
  const [staged, setStaged] = useState<string[]>([]);
  // 대기 게임 → 코트 배정 모드
  const [assigningEntryId, setAssigningEntryId] = useState<string | null>(null);

  const bounceAnims = useRef([0, 1, 2, 3].map(() => new RNAnimated.Value(1))).current;

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

  // NameSkill 컴포넌트: "이경윤S" 형태
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

  // ─── 대기 등록 (코트 없이) ──────────────
  const handleSubmit = useCallback(async () => {
    if (staged.length !== 4) { showAlert('알림', '4명을 선택해주세요'); return; }
    try {
      await addEntry(staged);
      loadBoard();
      showSuccess('대기 등록 완료!');
      setStaged([]);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '등록 실패');
    }
  }, [staged, addEntry, loadBoard]);

  // ─── 대기 게임 → 코트 배정 ─────────────
  const startAssign = useCallback((entryId: string) => {
    setAssigningEntryId((prev) => (prev === entryId ? null : entryId));
  }, []);

  const handleAssignToCourt = useCallback(async (courtId: string) => {
    if (!assigningEntryId) return;
    try {
      await pushEntry(assigningEntryId, courtId);
      loadBoard();
      showSuccess('코트에 배정됨!');
      setAssigningEntryId(null);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '배정 실패');
    }
  }, [assigningEntryId, pushEntry, loadBoard]);

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

  const handlePushAll = useCallback(
    () =>
      showConfirm('전체 걸기', '대기 게임을 빈 코트에 순서대로 배정할까요?', async () => {
        try {
          await pushAll();
          loadBoard();
          showSuccess('전체 배정됨');
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '배정 실패');
        }
      }),
    [pushAll, loadBoard],
  );

  if (loading && !board) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator style={{ marginTop: 100 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  const stagedSet = new Set(staged);
  const isAssigning = !!assigningEntryId;

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
        {queuedEntries.length > 0 && (
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.primary }]}
            onPress={handlePushAll}
          >
            <Text style={styles.headerBtnText}>전체 걸기</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>

        {/* ═══ Section 1: 게임 진행 (코트 현황) ═══ */}
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.sectionBar, { backgroundColor: colors.primary }]}>
            <Text style={styles.sectionBarText}>게임 진행 명단</Text>
          </View>

          {/* 코트 배정 모드 안내 */}
          {isAssigning && (
            <View style={[styles.assignBanner, { backgroundColor: colors.warningBg }]}>
              <Text style={[styles.assignBannerText, { color: colors.warning }]}>
                배정할 코트를 탭하세요
              </Text>
              <TouchableOpacity onPress={() => setAssigningEntryId(null)}>
                <Text style={[styles.assignBannerCancel, { color: colors.textSecondary }]}>취소</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.courtsRow}>
            {courts.map((court, ci) => {
              const playing = playingByCourtId.get(court.id);
              const isLast = ci === courts.length - 1;
              const isEmpty = !playing;
              return (
                <TouchableOpacity
                  key={court.id}
                  style={[
                    styles.courtCol,
                    !isLast && { borderRightWidth: 1, borderRightColor: colors.border },
                    isAssigning && isEmpty && { backgroundColor: colors.warningBg },
                  ]}
                  activeOpacity={isAssigning && isEmpty ? 0.6 : 1}
                  onPress={() => {
                    if (isAssigning && isEmpty) handleAssignToCourt(court.id);
                  }}
                  disabled={!isAssigning || !isEmpty}
                >
                  <View style={[styles.courtColHead, { backgroundColor: playing ? colors.primaryLight : colors.background }]}>
                    <Text style={[styles.courtColHeadText, { color: playing ? colors.primary : colors.textSecondary }]}>
                      {court.name}
                    </Text>
                    {playing && <View style={[styles.dot, { backgroundColor: colors.courtInGame }]} />}
                    {isAssigning && isEmpty && (
                      <Text style={[styles.courtDropHint, { color: colors.warning }]}>← 여기</Text>
                    )}
                  </View>
                  <View style={styles.courtColBody}>
                    {playing ? (
                      playing.playerIds.map((pId, i) => (
                        <View key={i} style={[styles.pRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
                          <NameSkill userId={pId} style={[styles.pName, { color: colors.text }]} />
                        </View>
                      ))
                    ) : (
                      <View style={styles.emptyCourtBody}>
                        <Text style={[styles.emptyCourtText, { color: isAssigning ? colors.warning : colors.textLight }]}>
                          {isAssigning ? '탭하여 배정' : '비어있음'}
                        </Text>
                      </View>
                    )}
                    {playing && playing.playerIds.length < 4 &&
                      Array.from({ length: 4 - playing.playerIds.length }).map((_, i) => (
                        <View key={`e${i}`} style={[styles.pRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
                          <Text style={[styles.pName, { color: colors.textLight }]}>-</Text>
                        </View>
                      ))
                    }
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ═══ Section 2: 대기 명단 ═══ */}
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.sectionBar, { backgroundColor: colors.warning }]}>
            <Text style={styles.sectionBarText}>대기 명단 ({queuedEntries.length})</Text>
          </View>

          {queuedEntries.length === 0 ? (
            <View style={styles.emptyQueue}>
              <Text style={[styles.emptyQueueText, { color: colors.textLight }]}>
                아래 회원을 탭하여 게임을 편성하세요
              </Text>
            </View>
          ) : (
            queuedEntries.map((entry, idx) => {
              const isActive = assigningEntryId === entry.id;
              return (
                <View
                  key={entry.id}
                  style={[
                    styles.qRow,
                    { borderBottomColor: colors.divider },
                    isActive && { backgroundColor: colors.warningBg },
                  ]}
                >
                  <View style={[styles.qNum, { backgroundColor: isActive ? colors.warning : colors.primaryLight }]}>
                    <Text style={[styles.qNumText, { color: isActive ? '#fff' : colors.primary }]}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1, paddingHorizontal: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {entry.playerIds.map((pId, i) => (
                      <Text key={pId} style={{ fontSize: 13, color: colors.text }}>
                        {i > 0 && <Text style={{ color: colors.textLight }}> / </Text>}
                        <NameSkill userId={pId} style={{ fontSize: 13 }} />
                      </Text>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.qBtn, { backgroundColor: isActive ? colors.textSecondary : colors.primary }]}
                    onPress={() => startAssign(entry.id)}
                  >
                    <Text style={styles.qBtnText}>{isActive ? '취소' : '코트 배정'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.qBtn, { backgroundColor: colors.danger }]}
                    onPress={() => handleDelete(entry.id)}
                  >
                    <Text style={styles.qBtnText}>삭제</Text>
                  </TouchableOpacity>
                </View>
              );
            })
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

      {/* ══════════════════════════════════════════
          Fixed Bottom: 게임 편성 트레이
         ══════════════════════════════════════════ */}
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

  // Assign banner
  assignBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  assignBannerText: { ...typography.caption, fontWeight: '700' },
  assignBannerCancel: { ...typography.buttonSm },

  // Courts
  courtsRow: { flexDirection: 'row' },
  courtCol: { flex: 1 },
  courtColHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, gap: 4,
  },
  courtColHeadText: { ...typography.subtitle2, textAlign: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  courtDropHint: { fontSize: 10, fontWeight: '700' },
  courtColBody: { minHeight: 96 },
  pRow: { paddingVertical: 5, paddingHorizontal: spacing.sm, alignItems: 'center' },
  pName: { ...typography.body2, textAlign: 'center' },
  emptyCourtBody: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 96 },
  emptyCourtText: { ...typography.caption },

  // Queue
  emptyQueue: { paddingVertical: spacing.xl, alignItems: 'center' },
  emptyQueueText: { ...typography.caption },
  qRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.smd, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.xs,
  },
  qNum: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  qNumText: { fontSize: 13, fontWeight: '800' },
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

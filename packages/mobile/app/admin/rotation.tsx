import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { clubSessionApi } from '../../services/clubSession';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import api from '../../services/api';
import { rotationApi } from '../../services/rotation';

interface Player {
  userId: string;
  userName: string;
  status: string;
  gamesPlayedToday: number;
  skillLevel?: string;
}

interface Court {
  id: string;
  name: string;
  status: string;
}

interface RotationSlot {
  id: string;
  round: number;
  courtIndex: number;
  courtName: string;
  playerNames: string[];
  materialized: boolean;
  completed: boolean;
}

interface RotationSchedule {
  id: string;
  status: string;
  totalRounds: number;
  currentRound: number;
  playerCount: number;
  courtCount: number;
  slots: RotationSlot[];
  players: { userId: string; userName: string; gamesAssigned: number; gamesPlayed: number; sittingOut: number }[];
}

type SkillFilter = 'ALL' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

const SKILL_FILTERS: { key: SkillFilter; label: string }[] = [
  { key: 'ALL', label: Strings.admin.filterAll },
  { key: 'S', label: Strings.player.skillLevel.S },
  { key: 'A', label: Strings.player.skillLevel.A },
  { key: 'B', label: Strings.player.skillLevel.B },
  { key: 'C', label: Strings.player.skillLevel.C },
  { key: 'D', label: Strings.player.skillLevel.D },
  { key: 'E', label: Strings.player.skillLevel.E },
  { key: 'F', label: Strings.player.skillLevel.F },
];

export default function RotationScreen() {
  const router = useRouter();
  const { clubSessionId } = useLocalSearchParams<{ clubSessionId?: string }>();
  const { status: checkinStatus } = useCheckinStore();
  const facilityId = checkinStatus?.facilityId;

  const [players, setPlayers] = useState<Player[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [selectedCourts, setSelectedCourts] = useState<Set<string>>(new Set());
  const [targetRounds, setTargetRounds] = useState<number | undefined>(undefined);
  const [schedule, setSchedule] = useState<RotationSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('ALL');
  const [swapMode, setSwapMode] = useState<{ slotId: string; playerIndex: number } | null>(null);

  const loadData = useCallback(async () => {
    if (!facilityId) return;
    try {
      const [playersRes, courtsRes, rotationRes] = await Promise.all([
        api.get(`/facilities/${facilityId}/players`),
        api.get(`/facilities/${facilityId}/courts`),
        rotationApi.getCurrent(facilityId).catch(() => ({ data: null })),
      ]);
      const loadedPlayers = playersRes.data || [];
      const loadedCourts = (courtsRes.data || []).filter((c: Court) => c.status !== 'MAINTENANCE');
      setPlayers(loadedPlayers);
      setCourts(loadedCourts);

      if (rotationRes.data) {
        setSchedule(rotationRes.data);
      }

      // Pre-select from club session if provided
      if (clubSessionId && !rotationRes.data) {
        try {
          // Find the club session to get its courtIds
          // We try to get it by checking the session details from club members endpoint
          const { data: boardData } = await api.get(`/facilities/${facilityId}/board`);
          const sessionCourtIds = new Set<string>();
          for (const item of boardData || []) {
            if (item.clubSessionInfo?.clubSessionId === clubSessionId) {
              sessionCourtIds.add(item.court.id);
            }
          }
          if (sessionCourtIds.size > 0) {
            setSelectedCourts(sessionCourtIds);
          }

          // Pre-select available players
          const availablePlayerIds = new Set<string>(
            loadedPlayers
              .filter((p: Player) => p.status === 'AVAILABLE')
              .map((p: Player) => p.userId),
          );
          setSelectedPlayers(availablePlayerIds);
        } catch { /* silent */ }
      }
    } catch { /* silent */ }
  }, [facilityId, clubSessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const togglePlayer = (userId: string) => {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourts((prev) => {
      const next = new Set(prev);
      if (next.has(courtId)) next.delete(courtId);
      else next.add(courtId);
      return next;
    });
  };

  const availablePlayers = players.filter((p) => p.status === 'AVAILABLE');

  const selectAllPlayers = () => {
    const filtered = getFilteredPlayers();
    if (filtered.every((p) => selectedPlayers.has(p.userId))) {
      // Deselect filtered
      setSelectedPlayers((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.userId));
        return next;
      });
    } else {
      setSelectedPlayers((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.userId));
        return next;
      });
    }
  };

  const selectAllCourts = () => {
    if (selectedCourts.size === courts.length) {
      setSelectedCourts(new Set());
    } else {
      setSelectedCourts(new Set(courts.map((c) => c.id)));
    }
  };

  const getFilteredPlayers = () => {
    if (skillFilter === 'ALL') return availablePlayers;
    return availablePlayers.filter((p) => p.skillLevel === skillFilter);
  };

  const handleSlotTap = (slotId: string, playerIndex: number) => {
    if (!schedule || schedule.status !== 'DRAFT') return;
    if (swapMode) {
      if (swapMode.slotId === slotId && swapMode.playerIndex === playerIndex) {
        setSwapMode(null);
        return;
      }
      // Attempt swap via alert
      const sourceSlot = schedule.slots.find((s) => s.id === swapMode.slotId);
      const targetSlot = schedule.slots.find((s) => s.id === slotId);
      if (!sourceSlot || !targetSlot) return;

      const sourceName = sourceSlot.playerNames[swapMode.playerIndex];
      const targetName = targetSlot.playerNames[playerIndex];

      showConfirm(
        Strings.admin.swapPlayers,
        `${sourceName} <-> ${targetName}`,
        () => {
          // Local swap for draft preview
          setSchedule((prev) => {
            if (!prev) return prev;
            const newSlots = prev.slots.map((s) => {
              if (s.id === swapMode.slotId) {
                const newNames = [...s.playerNames];
                newNames[swapMode.playerIndex] = targetName;
                return { ...s, playerNames: newNames };
              }
              if (s.id === slotId) {
                const newNames = [...s.playerNames];
                newNames[playerIndex] = sourceName;
                return { ...s, playerNames: newNames };
              }
              return s;
            });
            return { ...prev, slots: newSlots };
          });
          setSwapMode(null);
        },
        Strings.common.confirm,
      );
    } else {
      setSwapMode({ slotId, playerIndex });
    }
  };

  const handleGenerate = async () => {
    if (selectedPlayers.size < 4) {
      showAlert('알림', '최소 4명을 선택하세요');
      return;
    }
    if (selectedCourts.size === 0) {
      showAlert('알림', '최소 1개 코트를 선택하세요');
      return;
    }

    setLoading(true);
    try {
      const { data } = await rotationApi.generate(facilityId!, {
        playerIds: Array.from(selectedPlayers),
        courtIds: Array.from(selectedCourts),
        targetRounds,
        ...(clubSessionId && { clubSessionId }),
      });
      setSchedule(data);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '편성 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!schedule) return;
    try {
      const { data } = await rotationApi.start(schedule.id);
      setSchedule(data);
      showAlert('시작', '로테이션이 시작되었습니다!');
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '시작 실패');
    }
  };

  const handleCancel = async () => {
    if (!schedule) return;
    showConfirm(
      Strings.rotation.cancel,
      '로테이션을 취소하시겠습니까?',
      async () => {
        try {
          await rotationApi.cancel(schedule.id);
          setSchedule(null);
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '취소 실패');
        }
      },
      Strings.rotation.cancel,
    );
  };

  const handleRegenerate = async () => {
    if (!schedule) return;
    try {
      const { data } = await rotationApi.regenerate(schedule.id);
      setSchedule(data);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '재편성 실패');
    }
  };

  if (!facilityId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>체크인 후 사용 가능</Text>
      </View>
    );
  }

  // Schedule view with matrix table and enhanced UX
  if (schedule) {
    const rounds: number[] = [];
    for (let r = 1; r <= schedule.totalRounds; r++) {
      rounds.push(r);
    }

    // Get unique court names for matrix columns
    const courtNames = [...new Set(schedule.slots.map((s) => s.courtName))];

    // Compute round completion status
    const getRoundStatus = (round: number): 'completed' | 'in_progress' | 'pending' => {
      const roundSlots = schedule.slots.filter((s) => s.round === round);
      if (roundSlots.every((s) => s.completed)) return 'completed';
      if (roundSlots.some((s) => s.materialized || s.completed)) return 'in_progress';
      return 'pending';
    };

    const roundStatusColor = (status: string) => {
      if (status === 'completed') return Colors.secondary;
      if (status === 'in_progress') return Colors.primary;
      return Colors.textLight;
    };

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.header}>{Strings.rotation.title}</Text>
        <View style={styles.scheduleMeta}>
          <Text style={styles.scheduleStatus}>
            {schedule.status === 'DRAFT' ? '미리보기' :
              schedule.status === 'ACTIVE' ? `${Strings.admin.inProgress} (${Strings.admin.roundLabel} ${schedule.currentRound}/${schedule.totalRounds})` :
              schedule.status === 'COMPLETED' ? Strings.admin.completed : Strings.rotation.status.CANCELLED}
          </Text>
          <Text style={styles.scheduleDetail}>
            {schedule.playerCount}명 / {schedule.courtCount}코트 / {schedule.totalRounds}{Strings.admin.roundLabel}
          </Text>
        </View>

        {/* Round progress indicators */}
        <View style={styles.roundProgressBar}>
          {rounds.map((round) => {
            const status = getRoundStatus(round);
            return (
              <View key={round} style={styles.roundProgressItem}>
                <View style={[styles.roundProgressDot, { backgroundColor: roundStatusColor(status) }]} />
                <Text style={[styles.roundProgressLabel, { color: roundStatusColor(status) }]}>
                  R{round}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Swap mode indicator */}
        {swapMode && schedule.status === 'DRAFT' && (
          <View style={styles.swapBanner}>
            <Text style={styles.swapBannerText}>{Strings.admin.swapInstruction}</Text>
            <TouchableOpacity onPress={() => setSwapMode(null)}>
              <Text style={styles.swapCancelText}>{Strings.common.cancel}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Matrix table: rounds x courts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.admin.roundMatrix}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header row */}
              <View style={styles.matrixRow}>
                <View style={styles.matrixHeaderCell}>
                  <Text style={styles.matrixHeaderText}>{Strings.admin.roundLabel}</Text>
                </View>
                {courtNames.map((name) => (
                  <View key={name} style={styles.matrixHeaderCell}>
                    <Text style={styles.matrixHeaderText}>{name}</Text>
                  </View>
                ))}
              </View>
              {/* Data rows */}
              {rounds.map((round) => {
                const roundSlots = schedule.slots.filter((s) => s.round === round);
                const isCurrentRound = schedule.status === 'ACTIVE' && round === schedule.currentRound;
                const roundStatus = getRoundStatus(round);

                return (
                  <View key={round} style={[styles.matrixRow, isCurrentRound && styles.matrixCurrentRow]}>
                    <View style={styles.matrixRoundCell}>
                      <View style={[styles.matrixRoundDot, { backgroundColor: roundStatusColor(roundStatus) }]} />
                      <Text style={[styles.matrixRoundText, isCurrentRound && { fontWeight: '700', color: '#7C3AED' }]}>
                        R{round}
                      </Text>
                    </View>
                    {courtNames.map((courtName) => {
                      const slot = roundSlots.find((s) => s.courtName === courtName);
                      if (!slot) {
                        return (
                          <View key={courtName} style={styles.matrixCell}>
                            <Text style={styles.matrixCellEmpty}>-</Text>
                          </View>
                        );
                      }
                      return (
                        <View key={courtName} style={[
                          styles.matrixCell,
                          slot.completed && styles.matrixCellCompleted,
                          slot.materialized && !slot.completed && styles.matrixCellActive,
                          swapMode?.slotId === slot.id && styles.matrixCellSwapSource,
                        ]}>
                          {slot.playerNames.map((name, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => schedule.status === 'DRAFT' ? handleSlotTap(slot.id, idx) : undefined}
                              activeOpacity={schedule.status === 'DRAFT' ? 0.6 : 1}
                            >
                              <Text style={[
                                styles.matrixPlayerName,
                                swapMode?.slotId === slot.id && swapMode.playerIndex === idx && styles.matrixPlayerSwap,
                              ]}>
                                {name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Player stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.admin.participantStats}</Text>
          {schedule.players.map((p) => {
            const progress = p.gamesAssigned > 0 ? p.gamesPlayed / p.gamesAssigned : 0;
            return (
              <View key={p.userId} style={styles.playerStatRow}>
                <Text style={styles.playerStatName}>{p.userName}</Text>
                <View style={styles.playerProgressContainer}>
                  <View style={styles.playerProgressBar}>
                    <View style={[styles.playerProgressFill, { flex: progress, backgroundColor: Colors.primary }]} />
                    <View style={{ flex: 1 - progress }} />
                  </View>
                </View>
                <Text style={styles.playerStatGames}>
                  {p.gamesPlayed}/{p.gamesAssigned}
                </Text>
                {p.sittingOut > 0 && (
                  <Text style={styles.playerStatSit}>쉼{p.sittingOut}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Round details (legacy list view) */}
        {rounds.map((round) => {
          const roundSlots = schedule.slots.filter((s) => s.round === round);
          const isCurrentRound = schedule.status === 'ACTIVE' && round === schedule.currentRound;
          const roundStatus = getRoundStatus(round);

          return (
            <View key={round} style={[styles.roundSection, isCurrentRound && styles.currentRound]}>
              <View style={styles.roundTitleRow}>
                <View style={[styles.roundIndicator, { backgroundColor: roundStatusColor(roundStatus) }]} />
                <Text style={styles.roundTitle}>
                  {Strings.admin.roundLabel} {round}
                  {isCurrentRound && ` (${Strings.admin.currentRound})`}
                </Text>
                <Text style={[styles.roundStatusLabel, { color: roundStatusColor(roundStatus) }]}>
                  {roundStatus === 'completed' ? Strings.admin.completed
                    : roundStatus === 'in_progress' ? Strings.admin.inProgress
                    : Strings.admin.pending}
                </Text>
              </View>
              {roundSlots.map((slot) => (
                <View key={slot.id} style={[
                  styles.slotCard,
                  slot.completed && styles.slotCompleted,
                ]}>
                  <Text style={styles.slotCourt}>{slot.courtName}</Text>
                  <Text style={styles.slotPlayers}>
                    {slot.playerNames.join(' / ')}
                  </Text>
                  {slot.completed && (
                    <Text style={styles.slotStatusText}>{Strings.admin.completed}</Text>
                  )}
                  {slot.materialized && !slot.completed && (
                    <Text style={[styles.slotStatusText, { color: Colors.primary }]}>{Strings.admin.inProgress}</Text>
                  )}
                </View>
              ))}
            </View>
          );
        })}

        {/* Actions */}
        <View style={styles.actions}>
          {schedule.status === 'DRAFT' && (
            <>
              <TouchableOpacity style={[styles.startBtn, { backgroundColor: Colors.primary }]} onPress={handleStart}>
                <Text style={styles.startBtnText}>{Strings.rotation.start}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.warning }]} onPress={handleRegenerate}>
                <Text style={styles.actionBtnText}>{Strings.rotation.regenerate}</Text>
              </TouchableOpacity>
            </>
          )}
          {(schedule.status === 'DRAFT' || schedule.status === 'ACTIVE') && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.danger }]} onPress={handleCancel}>
              <Text style={styles.actionBtnText}>{Strings.rotation.cancel}</Text>
            </TouchableOpacity>
          )}
          {(schedule.status === 'COMPLETED' || schedule.status === 'CANCELLED') && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.primary }]} onPress={() => setSchedule(null)}>
              <Text style={styles.actionBtnText}>새 편성 만들기</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  // No schedule -- show creation form with skill filter
  const filteredPlayers = getFilteredPlayers();
  const allFilteredSelected = filteredPlayers.length > 0 && filteredPlayers.every((p) => selectedPlayers.has(p.userId));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.header}>{Strings.rotation.title}</Text>
      <Text style={styles.subText}>
        체크인된 플레이어를 선택하고 코트를 지정하세요
      </Text>

      {/* Player selection with skill filter */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            플레이어 ({selectedPlayers.size}명 선택 / {availablePlayers.length}명 대기)
          </Text>
          <TouchableOpacity onPress={selectAllPlayers}>
            <Text style={styles.selectAllText}>
              {allFilteredSelected ? Strings.admin.deselectAll : Strings.admin.selectAll}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Skill level filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {SKILL_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, skillFilter === f.key && styles.filterChipActive]}
              onPress={() => setSkillFilter(f.key)}
            >
              <Text style={[styles.filterChipText, skillFilter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filteredPlayers.map((p) => (
          <TouchableOpacity
            key={p.userId}
            style={[styles.selectRow, selectedPlayers.has(p.userId) && styles.selectRowActive]}
            onPress={() => togglePlayer(p.userId)}
          >
            <View style={[styles.checkbox, selectedPlayers.has(p.userId) && styles.checkboxActive]}>
              {selectedPlayers.has(p.userId) && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.selectName}>{p.userName}</Text>
            {p.skillLevel && (
              <View style={styles.skillBadge}>
                <Text style={styles.skillBadgeText}>
                  {Strings.player.skillLevel[p.skillLevel as keyof typeof Strings.player.skillLevel] || p.skillLevel}
                </Text>
              </View>
            )}
            <Text style={styles.selectMeta}>오늘 {p.gamesPlayedToday}게임</Text>
          </TouchableOpacity>
        ))}
        {filteredPlayers.length === 0 && (
          <Text style={styles.unavailableNote}>
            {skillFilter === 'ALL' ? '대기 중인 플레이어가 없습니다' : '해당 레벨의 대기 플레이어가 없습니다'}
          </Text>
        )}
        {players.filter((p) => p.status !== 'AVAILABLE').length > 0 && (
          <Text style={styles.unavailableNote}>
            게임중/휴식 {players.filter((p) => p.status !== 'AVAILABLE').length}명 제외
          </Text>
        )}
      </View>

      {/* Court selection */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            코트 ({selectedCourts.size}개 선택)
          </Text>
          <TouchableOpacity onPress={selectAllCourts}>
            <Text style={styles.selectAllText}>
              {selectedCourts.size === courts.length ? Strings.admin.deselectAll : Strings.admin.selectAll}
            </Text>
          </TouchableOpacity>
        </View>
        {courts.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.selectRow, selectedCourts.has(c.id) && styles.selectRowActive]}
            onPress={() => toggleCourt(c.id)}
          >
            <View style={[styles.checkbox, selectedCourts.has(c.id) && styles.checkboxActive]}>
              {selectedCourts.has(c.id) && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.selectName}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Info */}
      {selectedPlayers.size >= 4 && selectedCourts.size > 0 && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {selectedPlayers.size}명 / {selectedCourts.size}코트
            {selectedPlayers.size === selectedCourts.size * 4
              ? ' = 먹고치기 (대기 없음)'
              : selectedPlayers.size > selectedCourts.size * 4
                ? ` (매 라운드 ${selectedPlayers.size - selectedCourts.size * 4}명 대기)`
                : ' (인원 부족 — 일부 코트 비어있을 수 있음)'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.generateBtn, loading && { opacity: 0.6 }]}
        onPress={handleGenerate}
        disabled={loading}
      >
        <Text style={styles.generateBtnText}>
          {loading ? Strings.common.loading : Strings.rotation.generate}
        </Text>
      </TouchableOpacity>
      <Text style={styles.generateHelpText}>
        선택한 선수와 코트로 최적의 게임 편성을 자동 생성합니다
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  header: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 6,
  },
  subText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  // Section header with select all
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
  },
  // Filter chips
  filterRow: {
    marginBottom: 8,
    flexGrow: 0,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  // Skill badge
  skillBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.primaryLight,
  },
  skillBadgeText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    gap: 10,
  },
  selectRowActive: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  selectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  selectMeta: {
    fontSize: 12,
    color: Colors.textLight,
  },
  unavailableNote: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 4,
    fontStyle: 'italic',
  },
  infoBox: {
    backgroundColor: '#EDE9FE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    color: '#7C3AED',
    fontWeight: '500',
  },
  generateBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  generateHelpText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  // Schedule view
  scheduleMeta: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  scheduleStatus: {
    fontSize: 17,
    fontWeight: '700',
    color: '#7C3AED',
    marginBottom: 4,
  },
  scheduleDetail: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  // Round progress bar
  roundProgressBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  roundProgressItem: {
    alignItems: 'center',
    gap: 2,
  },
  roundProgressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  roundProgressLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Swap banner
  swapBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swapBannerText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '500',
  },
  swapCancelText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '600',
  },
  // Matrix table
  matrixRow: {
    flexDirection: 'row',
  },
  matrixCurrentRow: {
    backgroundColor: '#EDE9FE',
  },
  matrixHeaderCell: {
    width: 100,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: Colors.primary,
    borderWidth: 0.5,
    borderColor: Colors.primaryLight,
    alignItems: 'center',
  },
  matrixHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  matrixRoundCell: {
    width: 100,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: Colors.surface,
    borderWidth: 0.5,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  matrixRoundDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  matrixRoundText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  matrixCell: {
    width: 100,
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: Colors.surface,
    borderWidth: 0.5,
    borderColor: Colors.border,
  },
  matrixCellCompleted: {
    backgroundColor: '#F0FDF4',
  },
  matrixCellActive: {
    backgroundColor: Colors.primaryLight,
  },
  matrixCellSwapSource: {
    backgroundColor: '#FEF3C7',
  },
  matrixCellEmpty: {
    fontSize: 12,
    color: Colors.textLight,
    textAlign: 'center',
  },
  matrixPlayerName: {
    fontSize: 11,
    color: Colors.text,
    lineHeight: 16,
  },
  matrixPlayerSwap: {
    color: Colors.danger,
    fontWeight: '700',
  },
  // Player stat with progress
  playerStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 3,
    gap: 8,
  },
  playerStatName: {
    width: 70,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  playerProgressContainer: {
    flex: 1,
  },
  playerProgressBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  playerProgressFill: {
    height: 6,
    borderRadius: 3,
  },
  playerStatGames: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  playerStatSit: {
    fontSize: 12,
    color: Colors.warning,
  },
  // Round sections
  roundSection: {
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
  },
  currentRound: {
    borderWidth: 2,
    borderColor: '#7C3AED',
  },
  roundTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  roundIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roundTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  roundStatusLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  slotCard: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  slotCompleted: {
    opacity: 0.5,
  },
  slotCourt: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 2,
  },
  slotPlayers: {
    fontSize: 13,
    color: Colors.text,
  },
  slotStatusText: {
    fontSize: 11,
    color: Colors.secondary,
    fontWeight: '600',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  startBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  startBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
});

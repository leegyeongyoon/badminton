import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
  TouchableOpacity, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { useResponsiveLayout } from '../../../hooks/useResponsiveLayout';
import { useAuthStore } from '../../../store/authStore';
import { useGameBoard } from '../../../hooks/useGameBoard';
import { useFacilityRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta } from '../../../constants/skill';
import { getGenderMeta } from '../../../constants/gender';
import { PlayerCard } from '../../../components/game-board/PlayerCard';
import api from '../../../services/api';
import { typography, spacing, radius, palette } from '../../../constants/theme';

const POLL_INTERVAL_MS = 10000;

interface Player {
  userId: string;
  userName: string;
  skillLevel?: string;
  gender?: 'M' | 'F' | null;
  status: string;
  gamesPlayedToday?: number;
  isGuest?: boolean;
}

/**
 * 보는 보드 — read-only live game board for everyone (members + guests).
 * Shows each court's current 4 players, the waiting line, and highlights the
 * viewer's own court / turn. Self-refreshes via socket events + light polling.
 */
export default function ViewBoardScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const { user } = useAuthStore();
  const layout = useResponsiveLayout();
  const cols = layout.columns; // 1 / 2 / 3

  const { board, loadBoard } = useGameBoard(clubSessionId);

  const [courts, setCourts] = useState<{ id: string; name: string; status: string; currentTurn?: { playerIds: string[]; playerNames: string[] } | null }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [dedicatedCourtIds, setDedicatedCourtIds] = useState<Set<string>>(new Set());
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const [clubName, setClubName] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // ─── Load session meta ───
  useEffect(() => {
    if (!clubSessionId) return;
    let alive = true;
    api.get(`/club-sessions/${clubSessionId}`).then(({ data }) => {
      if (!alive) return;
      setFacilityId(data?.facilityId);
      setClubName(data?.clubName || '');
      if (data?.courtIds) setDedicatedCourtIds(new Set(data.courtIds));
    }).catch(() => {});
    return () => { alive = false; };
  }, [clubSessionId]);

  // ─── Load courts + players ───
  const loadPool = useCallback(() => {
    if (!facilityId) return;
    Promise.all([
      // This 정모's OWN courts (per-정모 court model) + their current game —
      // NOT the facility's courts, whose ids won't match this session's games.
      api.get(`/club-sessions/${clubSessionId}/courts`).then(({ data }) =>
        setCourts((data || []).filter((c: any) => c.status !== 'MAINTENANCE')),
      ),
      api.get(`/facilities/${facilityId}/players`).then(({ data }) =>
        setPlayers(data || []),
      ),
    ]).catch(() => {}).finally(() => setLoaded(true));
  }, [facilityId]);

  useEffect(() => { loadPool(); }, [loadPool]);

  // ─── Real-time + light polling ───
  useFacilityRoom(facilityId);
  const refresh = useCallback(() => { loadPool(); loadBoard(); }, [loadPool, loadBoard]);
  useSocketEvent('players:updated', refresh);
  useSocketEvent('checkin:arrived', refresh);
  useSocketEvent('checkin:left', refresh);
  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('clubSession:courtsUpdated', refresh);

  useEffect(() => {
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // ─── Derived ───
  // Dedupe by userId — the pool feed can carry duplicate check-ins per user.
  const uniquePlayers = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) if (!map.has(p.userId)) map.set(p.userId, p);
    return Array.from(map.values());
  }, [players]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of uniquePlayers) map.set(p.userId, p);
    return map;
  }, [uniquePlayers]);
  const getPlayer = useCallback((id: string) => playerMap.get(id), [playerMap]);

  const playingByCourtId = useMemo(() => {
    const map = new Map<string, { playerIds: string[]; playerNames: string[] }>();
    for (const e of board?.entries || []) {
      if ((e.status === 'PLAYING' || e.status === 'MATERIALIZED') && e.courtId) {
        map.set(e.courtId, { playerIds: e.playerIds, playerNames: e.playerNames });
      }
    }
    // currentTurn from the session courts is authoritative — it also covers games
    // created directly on a court (no GameBoardEntry), e.g. seeded/auto-started.
    for (const c of courts) {
      const ct = c.currentTurn;
      if (ct && ct.playerIds?.length) {
        map.set(c.id, { playerIds: ct.playerIds, playerNames: ct.playerNames || [] });
      }
    }
    return map;
  }, [board, courts]);

  const queuedEntries = useMemo(
    () => (board?.entries || [])
      .filter((e) => e.status === 'QUEUED')
      .sort((a, b) => a.position - b.position),
    [board],
  );

  const onCourtPlayerIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of playingByCourtId.values()) for (const id of e.playerIds) s.add(id);
    return s;
  }, [playingByCourtId]);

  // Waiting line = checked-in players not currently on a court (available + resting),
  // sorted by fewest games (the rough fairness order).
  const waiting = useMemo(
    () => uniquePlayers
      .filter((p) => !onCourtPlayerIds.has(p.userId) && (p.status === 'AVAILABLE' || p.status === 'RESTING'))
      .sort((a, b) => (a.gamesPlayedToday ?? 0) - (b.gamesPlayedToday ?? 0)),
    [uniquePlayers, onCourtPlayerIds],
  );

  const displayCourts = useMemo(() => {
    const dedicated = courts.filter((c) => dedicatedCourtIds.has(c.id));
    return dedicated.length > 0 ? dedicated : courts;
  }, [courts, dedicatedCourtIds]);

  // Which court (if any) is the viewer playing on?
  const myCourtId = useMemo(() => {
    if (!user?.id) return null;
    for (const [courtId, e] of playingByCourtId.entries()) {
      if (e.playerIds.includes(user.id)) return courtId;
    }
    return null;
  }, [playingByCourtId, user?.id]);
  const myCourtName = useMemo(
    () => displayCourts.find((c) => c.id === myCourtId)?.name,
    [displayCourts, myCourtId],
  );
  const isMeWaiting = useMemo(
    () => !!user?.id && !myCourtId && waiting.some((p) => p.userId === user.id),
    [user?.id, myCourtId, waiting],
  );

  // ─────────────────────────────────────────────────────────
  // Sub-renderers
  // ─────────────────────────────────────────────────────────
  const courtWidthStyle = cols >= 3 ? styles.col3 : cols >= 2 ? styles.col2 : styles.col1;

  const CourtCard = ({ court }: { court: { id: string; name: string; status: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const isEmpty = !playing;
    const isMine = court.id === myCourtId;

    // Subtle pulse on the viewer's own court so it draws the eye across the grid.
    const pulse = useSharedValue(0);
    useEffect(() => {
      if (isMine) {
        pulse.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
            withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          false,
        );
      } else {
        pulse.value = 0;
      }
    }, [isMine, pulse]);
    const pulseStyle = useAnimatedStyle(() => ({ opacity: 0.45 + pulse.value * 0.55 }));

    return (
      <View
        style={[
          styles.courtCard,
          courtWidthStyle,
          { backgroundColor: colors.surface, borderColor: isMine ? colors.primary : colors.border },
          isMine && { borderWidth: 3, backgroundColor: colors.primaryBg },
          isMine ? shadows.lg : shadows.sm,
        ]}
      >
        <View style={styles.courtHeader}>
          <View style={styles.courtNameWrap}>
            {isMine && (
              <Animated.View style={[styles.mineDot, { backgroundColor: colors.primary }, pulseStyle]} />
            )}
            <Text
              style={[styles.courtName, { color: isMine ? colors.primary : colors.text }]}
              numberOfLines={1}
            >
              {court.name}
            </Text>
          </View>
          {isMine ? (
            <View style={[styles.mineBadge, { backgroundColor: colors.primary }]}>
              <Icon name="success" size={13} color={palette.white} />
              <Text style={styles.mineBadgeText}>내 코트</Text>
            </View>
          ) : (
            <View style={[
              styles.courtStateBadge,
              { backgroundColor: isEmpty ? colors.secondaryLight : colors.warningLight },
            ]}>
              <View style={[styles.courtStateDot, { backgroundColor: isEmpty ? colors.courtEmpty : colors.courtInGame }]} />
              <Text style={[styles.courtStateText, { color: isEmpty ? colors.secondary : colors.warning }]}>
                {isEmpty ? '비어있음' : '게임 중'}
              </Text>
            </View>
          )}
        </View>

        {playing ? (
          <View style={styles.match}>
            {[[0, 1], [2, 3]].map((pair, side) => (
              <View key={side} style={styles.teamCol}>
                <View style={styles.team}>
                  {pair.map((slotIdx) => {
                    const pId = playing.playerIds[slotIdx];
                    const p = pId ? getPlayer(pId) : null;
                    const name = p?.userName || playing.playerNames?.[slotIdx];
                    const isMe = !!user?.id && pId === user.id;
                    return pId ? (
                      <PlayerCard
                        key={slotIdx}
                        variant="court"
                        player={p || { userId: pId, userName: name }}
                        highlighted={isMe}
                        nameSuffix={isMe ? ' (나)' : ''}
                      />
                    ) : (
                      <View key={slotIdx} style={[styles.player, { borderColor: colors.border }]}>
                        <Text style={[styles.playerEmpty, { color: colors.textLight }]}>빈 자리</Text>
                      </View>
                    );
                  })}
                </View>
                {side === 0 && (
                  <View style={styles.vsRow}>
                    <View style={[styles.vsLine, { backgroundColor: colors.border }]} />
                    <View style={[styles.vsChip, { backgroundColor: colors.surfaceSecondary }]}>
                      <Text style={[styles.vs, { color: colors.textSecondary }]}>VS</Text>
                    </View>
                    <View style={[styles.vsLine, { backgroundColor: colors.border }]} />
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyBox, { borderColor: colors.border }]}>
            <Icon name="court" size={28} color={colors.textLight} />
            <Text style={[styles.emptyText, { color: colors.textLight }]}>비어있음</Text>
          </View>
        )}
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────
  if (!loaded && !board) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {clubName ? `${clubName} 현황 보드` : '게임 현황 보드'}
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            코트 {displayCourts.length}개 · 대기 {waiting.length}명
          </Text>
        </View>
        <View style={[styles.liveDotWrap, { backgroundColor: colors.secondaryLight }]}>
          <View style={[styles.liveDot, { backgroundColor: colors.secondary }]} />
          <Text style={[styles.liveText, { color: colors.secondary }]}>LIVE</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Viewer banner */}
        {myCourtId ? (
          <View style={[styles.myBanner, { backgroundColor: colors.primary }, shadows.lg]}>
            <View style={styles.myBannerIcon}>
              <Icon name="play" size={22} color={palette.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.myBannerLabel}>내 차례예요!</Text>
              <Text style={styles.myBannerCourt}>{myCourtName || '코트'}로 입장하세요</Text>
            </View>
          </View>
        ) : isMeWaiting ? (
          <View style={[styles.myBannerWait, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
            <Icon name="waiting" size={18} color={colors.primary} />
            <Text style={[styles.myBannerWaitText, { color: colors.primary }]}>
              대기 중이에요 — 배정되면 여기에서 바로 보여요
            </Text>
          </View>
        ) : null}

        {/* Courts grid */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>코트 현황</Text>
        <View style={styles.grid}>
          {displayCourts.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>지정된 코트가 없어요</Text>
          ) : (
            displayCourts.map((court) => <CourtCard key={court.id} court={court} />)
          )}
        </View>

        {/* Next-up queued games — each entry is one clearly-grouped team */}
        {queuedEntries.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>다음 게임 대기열</Text>
            <View style={styles.queueList}>
              {queuedEntries.map((entry, idx) => {
                const isNext = idx === 0;
                const meInEntry = !!user?.id && entry.playerIds.includes(user.id);
                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.queueEntry,
                      {
                        backgroundColor: isNext ? colors.primaryBg : colors.surface,
                        borderColor: isNext ? colors.primary : colors.border,
                      },
                      meInEntry && !isNext && { borderColor: colors.primary },
                      isNext ? shadows.md : shadows.sm,
                    ]}
                  >
                    {/* header: order + 다음 badge + court */}
                    <View style={styles.queueEntryHeader}>
                      <View style={[styles.queueNum, { backgroundColor: isNext ? colors.primary : colors.primaryLight }]}>
                        <Text style={[styles.queueNumText, { color: isNext ? palette.white : colors.primary }]}>{idx + 1}</Text>
                      </View>
                      {isNext && (
                        <View style={[styles.queueNext, { backgroundColor: colors.primary }]}>
                          <Text style={styles.queueNextText}>다음 게임</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }} />
                      <View style={[styles.queueCourtChip, { backgroundColor: colors.surfaceSecondary }]}>
                        <Icon name="court" size={12} color={colors.textSecondary} />
                        <Text style={[styles.queueCourtText, { color: colors.textSecondary }]}>
                          {entry.courtName || '코트 미정'}
                        </Text>
                      </View>
                    </View>

                    {/* grouped team of players */}
                    <View style={styles.queuePlayers}>
                      {entry.playerIds.map((pId, i) => {
                        const p = getPlayer(pId);
                        const skill = getSkillMeta(p?.skillLevel);
                        const g = getGenderMeta(p?.gender);
                        const isMe = !!user?.id && pId === user.id;
                        const hasSkill = !!p?.skillLevel;
                        return (
                          <View
                            key={pId}
                            style={[
                              styles.queuePlayerChip,
                              { backgroundColor: isMe ? colors.primaryLight : colors.surfaceSecondary },
                            ]}
                          >
                            <View
                              style={[
                                styles.queueSkillTag,
                                hasSkill
                                  ? { backgroundColor: skill.color, borderColor: skill.color }
                                  : { backgroundColor: colors.surface, borderColor: colors.border },
                              ]}
                            >
                              <Text style={[styles.queueSkillText, { color: hasSkill ? palette.white : colors.textLight }]}>
                                {hasSkill ? skill.level : '·'}
                              </Text>
                            </View>
                            <Text
                              style={[styles.queueName, { color: isMe ? colors.primary : colors.text }]}
                              numberOfLines={1}
                            >
                              {p?.userName || entry.playerNames?.[i] || '?'}{isMe ? ' (나)' : ''}
                            </Text>
                            {g && <Text style={[styles.queueGender, { color: g.color }]}>{g.symbol}</Text>}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Waiting line — scannable grid so spectators see who's up next at a glance */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>대기 중 {waiting.length}명</Text>
        {waiting.length === 0 ? (
          <View style={styles.waitWrap}>
            <Text style={[styles.empty, { color: colors.textLight }]}>대기 중인 사람이 없어요</Text>
          </View>
        ) : (
          <View style={styles.waitGrid}>
            {waiting.map((p) => {
              const isMe = !!user?.id && p.userId === user.id;
              return (
                <View key={p.userId} style={cols >= 2 ? styles.waitCell2 : styles.waitCell1}>
                  <PlayerCard
                    player={p}
                    highlighted={isMe}
                    nameSuffix={isMe ? ' (나)' : ''}
                  />
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, gap: spacing.md,
  },
  headerBack: { padding: spacing.xs },
  headerTitle: { ...typography.subtitle1 },
  headerSub: { ...typography.caption, marginTop: 1 },
  liveDotWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  content: { padding: spacing.lg, gap: spacing.sm },

  // Viewer banner
  myBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.sm,
  },
  myBannerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  myBannerLabel: { ...typography.subtitle2, color: palette.white, opacity: 0.92 },
  myBannerCourt: { ...typography.h2, color: palette.white },
  myBannerWait: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.card, borderWidth: 1.5, padding: spacing.md, marginBottom: spacing.sm,
  },
  myBannerWaitText: { ...typography.subtitle2, flex: 1 },

  sectionTitle: { ...typography.subtitle2, fontSize: 15, marginTop: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.xs },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  col1: { width: '100%' },
  col2: { width: '48.5%' },
  col3: { width: '31.8%' },
  empty: { ...typography.body2, padding: spacing.lg, textAlign: 'center', width: '100%' },

  // Court card — bigger, more scannable at arm's length
  courtCard: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.md, minHeight: 172 },
  courtHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
  courtNameWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  courtName: { ...typography.h3, flexShrink: 1 },
  mineDot: { width: 10, height: 10, borderRadius: 5 },
  courtStateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.smd, paddingVertical: 4, borderRadius: radius.pill,
  },
  courtStateDot: { width: 7, height: 7, borderRadius: 4 },
  courtStateText: { fontSize: 12, fontWeight: '800' },
  mineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill,
  },
  mineBadgeText: { color: palette.white, fontSize: 13, fontWeight: '900' },

  // Match 2v2 — stacked teams with a clear VS divider between them
  match: { gap: spacing.xs },
  teamCol: { gap: spacing.xs },
  team: { gap: spacing.xs },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  vsLine: { flex: 1, height: 1.5 },
  vsChip: { paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill },
  vs: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  // Empty on-court slot (PlayerCard handles filled slots)
  player: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.md, borderWidth: 1, minHeight: 38,
  },
  playerEmpty: { fontSize: 12, fontWeight: '600' },

  emptyBox: {
    minHeight: 96, borderWidth: 1, borderStyle: 'dashed',
    borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  emptyText: { ...typography.subtitle1 },

  // Queue — each entry is a grouped, bordered team card
  queueList: { gap: spacing.sm },
  queueEntry: { borderRadius: radius.card, borderWidth: 1.5, padding: spacing.md, gap: spacing.smd },
  queueEntryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  queueNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  queueNumText: { fontSize: 14, fontWeight: '900' },
  queueNext: { paddingHorizontal: spacing.smd, paddingVertical: 4, borderRadius: radius.pill },
  queueNextText: { color: palette.white, fontSize: 12, fontWeight: '900' },
  queueCourtChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill,
  },
  queueCourtText: { fontSize: 12, fontWeight: '800' },
  queuePlayers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  queuePlayerChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingLeft: spacing.xs, paddingRight: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.lg,
  },
  queueSkillTag: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  queueSkillText: { fontSize: 13, fontWeight: '900' },
  queueName: { fontSize: 15, fontWeight: '800', maxWidth: 110 },
  queueGender: { fontSize: 15, fontWeight: '900' },

  // Waiting line — wrapping grid
  waitWrap: { gap: spacing.sm },
  waitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  waitCell1: { width: '100%' },
  waitCell2: { width: '48.5%' },
});

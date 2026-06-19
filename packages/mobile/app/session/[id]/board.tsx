import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
  TouchableOpacity, Platform,
} from 'react-native';
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

  const [courts, setCourts] = useState<{ id: string; name: string; status: string }[]>([]);
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
      api.get(`/facilities/${facilityId}/courts`).then(({ data }) =>
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
    return map;
  }, [board]);

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
    return (
      <View
        style={[
          styles.courtCard,
          courtWidthStyle,
          { backgroundColor: colors.surface, borderColor: isMine ? colors.primary : colors.border },
          isMine && { borderWidth: 2.5, backgroundColor: colors.primaryBg },
          shadows.sm,
        ]}
      >
        <View style={styles.courtHeader}>
          <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          {isMine ? (
            <View style={[styles.mineBadge, { backgroundColor: colors.primary }]}>
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
              <View key={side} style={styles.teamWrap}>
                {side === 1 && <Text style={[styles.vs, { color: colors.textLight }]}>VS</Text>}
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
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyBox, { borderColor: colors.border }]}>
            <Icon name="court" size={26} color={colors.textLight} />
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
          <View style={[styles.myBanner, { backgroundColor: colors.primary }, shadows.md]}>
            <Text style={styles.myBannerLabel}>내 차례예요!</Text>
            <Text style={styles.myBannerCourt}>{myCourtName || '코트'}로 입장하세요</Text>
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

        {/* Next-up queued games */}
        {queuedEntries.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>다음 게임 대기열</Text>
            <View style={[styles.queueCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
              {queuedEntries.map((entry, idx) => (
                <View key={entry.id} style={[styles.queueRow, { borderBottomColor: colors.divider }]}>
                  <View style={[styles.queueNum, { backgroundColor: idx === 0 ? colors.primary : colors.primaryLight }]}>
                    <Text style={[styles.queueNumText, { color: idx === 0 ? palette.white : colors.primary }]}>{idx + 1}</Text>
                  </View>
                  <View style={styles.queueNames}>
                    {entry.playerIds.map((pId, i) => {
                      const p = getPlayer(pId);
                      const skill = getSkillMeta(p?.skillLevel);
                      const g = getGenderMeta(p?.gender);
                      const isMe = !!user?.id && pId === user.id;
                      return (
                        <View key={pId} style={styles.queueNameChip}>
                          <View style={[styles.queueDot, { backgroundColor: skill.color }]} />
                          <Text style={[styles.queueName, { color: isMe ? colors.primary : colors.textSecondary }]} numberOfLines={1}>
                            {p?.userName || entry.playerNames?.[i] || '?'}{isMe ? ' (나)' : ''}
                          </Text>
                          {g && <Text style={[styles.queueGender, { color: g.color }]}>{g.symbol}</Text>}
                        </View>
                      );
                    })}
                  </View>
                  {idx === 0 && <View style={[styles.queueNext, { backgroundColor: colors.primary }]}><Text style={styles.queueNextText}>다음</Text></View>}
                </View>
              ))}
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
  myBanner: { borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.sm, alignItems: 'center', gap: 2 },
  myBannerLabel: { ...typography.subtitle2, color: palette.white, opacity: 0.9 },
  myBannerCourt: { ...typography.h3, color: palette.white },
  myBannerWait: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.card, borderWidth: 1.5, padding: spacing.md, marginBottom: spacing.sm,
  },
  myBannerWaitText: { ...typography.subtitle2, flex: 1 },

  sectionTitle: { ...typography.overline, marginTop: spacing.sm, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  col1: { width: '100%' },
  col2: { width: '48.5%' },
  col3: { width: '31.8%' },
  empty: { ...typography.body2, padding: spacing.lg, textAlign: 'center', width: '100%' },

  // Court card
  courtCard: { borderRadius: radius.card, borderWidth: 1, padding: spacing.md, gap: spacing.sm, minHeight: 150 },
  courtHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  courtName: { ...typography.subtitle1, flex: 1 },
  courtStateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill,
  },
  courtStateDot: { width: 7, height: 7, borderRadius: 4 },
  courtStateText: { fontSize: 11, fontWeight: '700' },
  mineBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  mineBadgeText: { color: palette.white, fontSize: 11, fontWeight: '800' },

  // Match 2v2
  match: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  teamWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  vs: { fontSize: 11, fontWeight: '800', marginRight: spacing.sm },
  team: { flex: 1, gap: spacing.xs },
  // Empty on-court slot (PlayerCard handles filled slots)
  player: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.md, borderWidth: 1, minHeight: 38,
  },
  playerEmpty: { fontSize: 11, fontWeight: '600' },

  emptyBox: {
    minHeight: 84, borderWidth: 1, borderStyle: 'dashed',
    borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  emptyText: { ...typography.subtitle2 },

  // Queue
  queueCard: { borderRadius: radius.card, borderWidth: 1, padding: spacing.md, gap: spacing.xs },
  queueRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  queueNumText: { fontSize: 12, fontWeight: '800' },
  queueNames: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  queueNameChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  queueDot: { width: 8, height: 8, borderRadius: 4 },
  queueName: { fontSize: 13, fontWeight: '700' },
  queueGender: { fontSize: 12, fontWeight: '900' },
  queueNext: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm },
  queueNextText: { color: palette.white, fontSize: 10, fontWeight: '800' },

  // Waiting line — wrapping grid
  waitWrap: { gap: spacing.sm },
  waitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  waitCell1: { width: '100%' },
  waitCell2: { width: '48.5%' },
});

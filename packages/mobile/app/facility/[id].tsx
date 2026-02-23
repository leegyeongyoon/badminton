import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { facilityApi } from '../../services/facility';
import { useCheckinStore } from '../../store/checkinStore';
import { useFacilityStore } from '../../store/facilityStore';
import { useSocketEvent, useFacilityRoom } from '../../hooks/useSocket';
import FacilityMap from '../../components/FacilityMap';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

interface FacilityDetail {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  courts: CourtSummary[];
}

interface CourtSummary {
  id: string;
  name: string;
  status: string;
  gameType: string;
  playersRequired: number;
}

interface SessionInfo {
  id: string;
  status: string;
  openedAt: string;
}

interface CapacityInfo {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
}

interface BoardCourt {
  court: {
    id: string;
    name: string;
    status: string;
    gameType: string;
  };
  turns: {
    id: string;
    status: string;
    position: number;
    players: { id: string; userName: string }[];
    timeLimitAt: string | null;
  }[];
  maxTurns: number;
}

const courtStatusColors: Record<string, string> = {
  EMPTY: Colors.courtEmpty,
  IN_USE: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

export default function FacilityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { boardData, fetchBoard } = useFacilityStore();

  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [capacity, setCapacity] = useState<CapacityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isCheckedInHere = checkinStatus?.facilityId === id;

  useFacilityRoom(id);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [facilityRes, sessionRes, capacityRes] = await Promise.allSettled([
        facilityApi.get(id),
        facilityApi.getCurrentSession(id),
        facilityApi.getCapacity(id),
      ]);

      if (facilityRes.status === 'fulfilled') {
        setFacility(facilityRes.value.data);
      }
      if (sessionRes.status === 'fulfilled' && sessionRes.value.data) {
        setSession(sessionRes.value.data);
      } else {
        setSession(null);
      }
      if (capacityRes.status === 'fulfilled') {
        setCapacity(capacityRes.value.data);
      }

      // Load board data for per-court real-time status
      fetchBoard(id);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time updates
  const reload = useCallback(() => loadData(), [loadData]);
  useSocketEvent('court:statusChanged', reload);
  useSocketEvent('turn:created', reload);
  useSocketEvent('turn:completed', reload);
  useSocketEvent('players:updated', reload);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const formatSessionTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: Strings.facility.info }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </>
    );
  }

  if (!facility) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: Strings.facility.info }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>시설 정보를 불러올 수 없습니다</Text>
        </View>
      </>
    );
  }

  const emptyCourts = facility.courts.filter((c) => c.status === 'EMPTY').length;
  const inUseCourts = facility.courts.filter((c) => c.status === 'IN_USE').length;
  const maintenanceCourts = facility.courts.filter((c) => c.status === 'MAINTENANCE').length;
  const hasCoords = facility.latitude != null && facility.longitude != null;

  // Map board data by court ID for per-court mini cards
  const boardByCourt: Record<string, BoardCourt> = {};
  if (boardData) {
    (boardData as BoardCourt[]).forEach((item) => {
      boardByCourt[item.court.id] = item;
    });
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: facility.name }} />
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Facility Info */}
        <View style={styles.infoSection}>
          <Text style={styles.facilityName}>{facility.name}</Text>
          <Text style={styles.facilityAddress}>{facility.address}</Text>

          {/* Session status */}
          {session ? (
            <View style={styles.sessionActive}>
              <View style={styles.sessionDot} />
              <Text style={styles.sessionActiveText}>운영중</Text>
            </View>
          ) : (
            <View style={styles.sessionClosed}>
              <Text style={styles.sessionClosedText}>운영 종료</Text>
            </View>
          )}
        </View>

        {/* Operating hours (session-based) */}
        {session && (
          <View style={styles.hoursSection}>
            <Text style={styles.hoursSectionTitle}>{Strings.facility.operatingHours}</Text>
            <View style={styles.hoursCard}>
              <View style={styles.hoursRow}>
                <Text style={styles.hoursLabel}>{Strings.facility.sessionStarted}</Text>
                <Text style={styles.hoursValue}>{formatSessionTime(session.openedAt)}</Text>
              </View>
              <View style={styles.hoursRow}>
                <Text style={styles.hoursLabel}>현재 상태</Text>
                <View style={styles.hoursActiveBadge}>
                  <View style={styles.hoursActiveDot} />
                  <Text style={styles.hoursActiveText}>운영중</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Mini Map */}
        {hasCoords && (
          <View style={styles.mapSection}>
            <Text style={styles.mapSectionTitle}>{Strings.facility.location}</Text>
            <View style={styles.mapContainer}>
              <FacilityMap
                facilities={[{
                  id: facility.id,
                  name: facility.name,
                  address: facility.address,
                  latitude: facility.latitude,
                  longitude: facility.longitude,
                }]}
                onFacilitySelect={() => {}}
                userLocation={null}
                style={styles.miniMap}
              />
            </View>
          </View>
        )}

        {/* Capacity stats */}
        {capacity && session && (
          <View style={styles.statsSection}>
            <Text style={styles.sectionTitle}>현재 현황</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{capacity.totalCheckedIn}</Text>
                <Text style={styles.statLabel}>총 참가자</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: Colors.playerAvailable }]}>
                  {capacity.availableCount}
                </Text>
                <Text style={styles.statLabel}>{Strings.capacity.available}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: Colors.playerInTurn }]}>
                  {capacity.inTurnCount}
                </Text>
                <Text style={styles.statLabel}>{Strings.capacity.inTurn}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: Colors.playerResting }]}>
                  {capacity.restingCount}
                </Text>
                <Text style={styles.statLabel}>{Strings.capacity.resting}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Court status cards */}
        <View style={styles.courtsSection}>
          <Text style={styles.sectionTitle}>
            {Strings.facility.courtStatus} ({facility.courts.length}개)
          </Text>

          {/* Court status overview */}
          <View style={styles.courtOverview}>
            {emptyCourts > 0 && (
              <View style={styles.courtOverviewItem}>
                <View style={[styles.overviewDot, { backgroundColor: Colors.courtEmpty }]} />
                <Text style={styles.overviewText}>비어있음 {emptyCourts}</Text>
              </View>
            )}
            {inUseCourts > 0 && (
              <View style={styles.courtOverviewItem}>
                <View style={[styles.overviewDot, { backgroundColor: Colors.courtInGame }]} />
                <Text style={styles.overviewText}>사용중 {inUseCourts}</Text>
              </View>
            )}
            {maintenanceCourts > 0 && (
              <View style={styles.courtOverviewItem}>
                <View style={[styles.overviewDot, { backgroundColor: Colors.courtMaintenance }]} />
                <Text style={styles.overviewText}>점검중 {maintenanceCourts}</Text>
              </View>
            )}
          </View>

          {/* Per-court mini status cards */}
          {facility.courts.map((court) => {
            const boardItem = boardByCourt[court.id];
            const turns = boardItem?.turns || [];
            const playingTurn = turns.find((t) => t.status === 'PLAYING');
            const waitingCount = turns.filter((t) => t.status === 'WAITING').length;
            const maxTurns = boardItem?.maxTurns || 3;

            return (
              <TouchableOpacity
                key={court.id}
                style={styles.courtMiniCard}
                onPress={() => {
                  if (isCheckedInHere) {
                    router.push(`/court/${court.id}`);
                  }
                }}
                activeOpacity={isCheckedInHere ? 0.7 : 1}
              >
                <View style={styles.courtMiniHeader}>
                  <View style={styles.courtMiniLeft}>
                    <View style={[styles.courtMiniIndicator, {
                      backgroundColor: courtStatusColors[court.status] || Colors.textLight,
                    }]} />
                    <Text style={styles.courtMiniName}>{court.name}</Text>
                    {court.gameType === 'LESSON' && (
                      <View style={styles.lessonBadge}>
                        <Text style={styles.lessonBadgeText}>{Strings.court.gameType.LESSON}</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.courtMiniStatusBadge, {
                    backgroundColor: courtStatusColors[court.status] || Colors.textLight,
                  }]}>
                    <Text style={styles.courtMiniStatusText}>
                      {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
                    </Text>
                  </View>
                </View>

                {/* Turn fill bar */}
                {court.status !== 'MAINTENANCE' && (
                  <View style={styles.courtMiniFillBar}>
                    <View style={styles.courtMiniFillBg}>
                      <View style={[styles.courtMiniFillProgress, {
                        width: `${(turns.length / maxTurns) * 100}%`,
                        backgroundColor: turns.length >= maxTurns ? Colors.danger : Colors.primary,
                      }]} />
                    </View>
                    <Text style={styles.courtMiniFillText}>{turns.length}/{maxTurns}</Text>
                  </View>
                )}

                {/* Playing info */}
                {playingTurn && (
                  <View style={styles.courtMiniPlaying}>
                    <Text style={styles.courtMiniPlayingLabel}>{Strings.turn.status.PLAYING}:</Text>
                    <Text style={styles.courtMiniPlayingPlayers} numberOfLines={1}>
                      {playingTurn.players.map((p) => p.userName).join(', ')}
                    </Text>
                  </View>
                )}

                {/* Waiting count */}
                {waitingCount > 0 && (
                  <Text style={styles.courtMiniWaiting}>
                    대기 {waitingCount}순번
                  </Text>
                )}

                {isCheckedInHere && (
                  <Text style={styles.courtMiniArrow}>›</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bottom spacer for button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Check-in / Go to board button */}
      <View style={styles.bottomBar}>
        {isCheckedInHere ? (
          <TouchableOpacity
            style={[styles.mainButton, { backgroundColor: Colors.secondary }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.mainButtonText}>현황판으로 이동</Text>
          </TouchableOpacity>
        ) : session ? (
          <TouchableOpacity
            style={[styles.mainButton, { backgroundColor: Colors.primary }]}
            onPress={() => router.push('/(tabs)/checkin')}
          >
            <Text style={styles.mainButtonText}>QR 체크인</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.mainButton, { backgroundColor: Colors.textLight }]}>
            <Text style={styles.mainButtonText}>현재 운영중이 아닙니다</Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },

  // Info section
  infoSection: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  facilityName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  facilityAddress: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  sessionActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.secondary,
  },
  sessionActiveText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  sessionClosed: {
    alignSelf: 'flex-start',
  },
  sessionClosedText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textLight,
  },

  // Operating hours
  hoursSection: {
    padding: 16,
  },
  hoursSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  hoursCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hoursLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  hoursValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  hoursActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.secondaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  hoursActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  hoursActiveText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary,
  },

  // Mini map
  mapSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  mapSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  mapContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    height: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  miniMap: {
    flex: 1,
  },

  // Stats section
  statsSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },

  // Courts section
  courtsSection: {
    padding: 16,
  },
  courtOverview: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  courtOverviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overviewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  overviewText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },

  // Per-court mini status card
  courtMiniCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  courtMiniHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  courtMiniLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  courtMiniIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
  },
  courtMiniName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  lessonBadge: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lessonBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  courtMiniStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  courtMiniStatusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Turn fill bar
  courtMiniFillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  courtMiniFillBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  courtMiniFillProgress: {
    height: 4,
    borderRadius: 2,
  },
  courtMiniFillText: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // Playing info
  courtMiniPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  courtMiniPlayingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.courtInGame,
  },
  courtMiniPlayingPlayers: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  courtMiniWaiting: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },
  courtMiniArrow: {
    position: 'absolute',
    right: 14,
    top: '50%',
    fontSize: 20,
    color: Colors.textLight,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
  },
  mainButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  mainButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});

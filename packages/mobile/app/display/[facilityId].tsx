import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useFacilityRoom, useSocketEvent } from '../../hooks/useSocket';
import { Colors } from '../../constants/colors';
import api from '../../services/api';

const REFRESH_INTERVAL = 10000;

const courtStatusColors: Record<string, string> = {
  EMPTY: Colors.courtEmpty,
  IN_USE: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

const courtStatusLabels: Record<string, string> = {
  EMPTY: '비어있음',
  IN_USE: '사용 중',
  MAINTENANCE: '점검 중',
};

const { width: screenWidth } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const CARD_MARGIN = 8;
const CARD_WIDTH = (screenWidth - (NUM_COLUMNS + 1) * CARD_MARGIN * 2) / NUM_COLUMNS;

interface Capacity {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
}

export default function DisplayScreen() {
  const { facilityId } = useLocalSearchParams<{ facilityId: string }>();
  const [displayData, setDisplayData] = useState<any>(null);
  const [facilityName, setFacilityName] = useState('');
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useFacilityRoom(facilityId);

  const loadDisplay = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/display`);
      setDisplayData(data.courts || data);
      if (data.facilityName) {
        setFacilityName(data.facilityName);
      }
    } catch {
      // Silent fail
    }
  }, [facilityId]);

  const loadCapacity = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/capacity`);
      setCapacity(data);
    } catch { /* silent */ }
  }, [facilityId]);

  useEffect(() => {
    loadDisplay();
    loadCapacity();

    // Auto-refresh every 10 seconds
    intervalRef.current = setInterval(() => {
      loadDisplay();
      loadCapacity();
    }, REFRESH_INTERVAL);

    // Update clock every second
    clockRef.current = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [loadDisplay, loadCapacity]);

  // Socket real-time updates
  const refreshHandler = useCallback(() => {
    loadDisplay();
    loadCapacity();
  }, [loadDisplay, loadCapacity]);
  useSocketEvent('court:statusChanged', refreshHandler);
  useSocketEvent('turn:created', refreshHandler);
  useSocketEvent('turn:promoted', refreshHandler);
  useSocketEvent('turn:started', refreshHandler);
  useSocketEvent('turn:completed', refreshHandler);
  useSocketEvent('turn:cancelled', refreshHandler);
  useSocketEvent('players:updated', loadCapacity);

  const renderCourtCard = ({ item }: { item: any }) => {
    const statusColor = courtStatusColors[item.status] || Colors.courtMaintenance;
    const statusLabel = courtStatusLabels[item.status] || '알 수 없음';

    // Find playing turn for timer
    const playingTurn = item.turnPreviews?.find((t: any) => t.status === 'PLAYING');

    return (
      <View style={[styles.courtCard, { borderLeftColor: statusColor }]}>
        {/* Court name */}
        <Text style={styles.courtName} numberOfLines={1}>
          {item.courtName}
        </Text>

        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>

        {/* Turn previews */}
        {item.turnPreviews?.map((turn: any, idx: number) => (
          <View key={idx} style={styles.turnPreview}>
            <Text style={styles.turnPosition}>
              {turn.position}순번 {turn.status === 'PLAYING' ? '(게임 중)' : '(대기)'}
            </Text>
            <View style={styles.playersSection}>
              {turn.players.map((name: string, pIdx: number) => (
                <Text key={pIdx} style={styles.playerName} numberOfLines={1}>
                  {name}
                </Text>
              ))}
            </View>
          </View>
        ))}

        {/* Timer for playing turn */}
        {item.timeLimitAt && (
          <DisplayTimer timeLimitAt={item.timeLimitAt} />
        )}

        {/* Turns count */}
        {item.status !== 'MAINTENANCE' && (
          <Text style={styles.turnsInfo}>
            {item.turnsCount}/{item.maxTurns} 순번
          </Text>
        )}
      </View>
    );
  };

  const courts = displayData || [];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>
              {facilityName || '배드민턴 코트 현황'}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.clockText}>
              {currentTime.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Text>
          </View>
        </View>

        {/* Capacity + Legend bar */}
        <View style={styles.legendBar}>
          {capacity && (
            <View style={styles.capacityDisplay}>
              <View style={styles.capacityItem}>
                <View style={[styles.capacityDot, { backgroundColor: Colors.playerAvailable }]} />
                <Text style={styles.capacityText}>대기 {capacity.availableCount}</Text>
              </View>
              <View style={styles.capacityItem}>
                <View style={[styles.capacityDot, { backgroundColor: Colors.playerInTurn }]} />
                <Text style={styles.capacityText}>게임중 {capacity.inTurnCount}</Text>
              </View>
              <View style={styles.capacityItem}>
                <View style={[styles.capacityDot, { backgroundColor: Colors.playerResting }]} />
                <Text style={styles.capacityText}>휴식 {capacity.restingCount}</Text>
              </View>
              <Text style={styles.capacityTotal}>총 {capacity.totalCheckedIn}명</Text>
            </View>
          )}
          <View style={styles.legendSection}>
            {Object.entries(courtStatusLabels).map(([key, label]) => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: courtStatusColors[key] }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Court grid */}
        <FlatList
          data={courts}
          renderItem={renderCourtCard}
          keyExtractor={(item, idx) => item.courtName || String(idx)}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>코트 정보를 불러오는 중...</Text>
            </View>
          }
        />
      </View>
    </>
  );
}

function DisplayTimer({ timeLimitAt }: { timeLimitAt: string }) {
  const [remaining, setRemaining] = useState('');
  const [color, setColor] = useState(Colors.timerSafe);

  useEffect(() => {
    const update = () => {
      const diff = new Date(timeLimitAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('시간 초과');
        setColor(Colors.timerDanger);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      if (minutes < 2) setColor(Colors.timerDanger);
      else if (minutes < 5) setColor(Colors.timerWarning);
      else setColor(Colors.timerSafe);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timeLimitAt]);

  return (
    <View style={[displayTimerStyles.container, { borderColor: color }]}>
      <Text style={[displayTimerStyles.text, { color }]}>{remaining}</Text>
    </View>
  );
}

const displayTimerStyles = StyleSheet.create({
  container: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 16,
    fontWeight: '800',
    // fontVariant removed for web compat
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#1E293B',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  clockText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#94A3B8',
    // fontVariant removed for web compat
  },
  legendBar: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  capacityDisplay: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  capacityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  capacityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  capacityText: {
    fontSize: 14,
    color: '#E2E8F0',
    fontWeight: '600',
  },
  capacityTotal: {
    fontSize: 14,
    color: '#94A3B8',
    marginLeft: 'auto',
    fontWeight: '600',
  },
  legendSection: {
    flexDirection: 'row',
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  grid: {
    padding: CARD_MARGIN,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: CARD_MARGIN * 2,
  },
  courtCard: {
    width: CARD_WIDTH,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: CARD_MARGIN * 2,
    borderLeftWidth: 4,
    borderLeftColor: Colors.courtEmpty,
  },
  courtName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  statusText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '700',
  },
  turnPreview: {
    marginBottom: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  turnPosition: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 4,
  },
  playersSection: {
    backgroundColor: '#334155',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  playerName: {
    fontSize: 15,
    color: '#E2E8F0',
    fontWeight: '500',
  },
  turnsInfo: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    color: '#64748B',
  },
});

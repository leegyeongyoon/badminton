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
  HELD: Colors.courtHeld,
  IN_GAME: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

const courtStatusLabels: Record<string, string> = {
  EMPTY: '비어있음',
  HELD: '홀드',
  IN_GAME: '게임 중',
  MAINTENANCE: '점검 중',
};

const { width: screenWidth } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const CARD_MARGIN = 8;
const CARD_WIDTH = (screenWidth - (NUM_COLUMNS + 1) * CARD_MARGIN * 2) / NUM_COLUMNS;

export default function DisplayScreen() {
  const { facilityId } = useLocalSearchParams<{ facilityId: string }>();
  const [displayData, setDisplayData] = useState<any>(null);
  const [facilityName, setFacilityName] = useState('');
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

  useEffect(() => {
    loadDisplay();

    // Auto-refresh every 10 seconds
    intervalRef.current = setInterval(loadDisplay, REFRESH_INTERVAL);

    // Update clock every second
    clockRef.current = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [loadDisplay]);

  // Socket real-time updates
  const refreshHandler = useCallback(() => loadDisplay(), [loadDisplay]);
  useSocketEvent('court:statusChanged', refreshHandler);
  useSocketEvent('hold:created', refreshHandler);
  useSocketEvent('hold:released', refreshHandler);
  useSocketEvent('game:started', refreshHandler);
  useSocketEvent('game:completed', refreshHandler);
  useSocketEvent('queue:joined', refreshHandler);
  useSocketEvent('queue:left', refreshHandler);
  useSocketEvent('queue:promoted', refreshHandler);

  const getHolderName = (item: any): string => {
    if (item.holdType === 'INDIVIDUAL') {
      return item.holderUserName || '개인';
    }
    return item.holdClubName || item.holderName || '';
  };

  const renderCourtCard = ({ item }: { item: any }) => {
    const statusColor = courtStatusColors[item.court?.status || item.status] || Colors.courtMaintenance;
    const statusLabel = courtStatusLabels[item.court?.status || item.status] || '알 수 없음';
    const courtName = item.court?.name || item.name || '코트';
    const status = item.court?.status || item.status;

    return (
      <View style={[styles.courtCard, { borderLeftColor: statusColor }]}>
        {/* Court name */}
        <Text style={styles.courtName} numberOfLines={1}>
          {courtName}
        </Text>

        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>

        {/* Holder name */}
        {(item.holdClubName || item.holderName || item.holderUserName) && (
          <View style={styles.holderRow}>
            <Text style={styles.holderIcon}>
              {item.holdType === 'INDIVIDUAL' ? '👤' : '👥'}
            </Text>
            <Text style={styles.holderName} numberOfLines={1}>
              {getHolderName(item)}
            </Text>
          </View>
        )}

        {/* Current players (if in game) */}
        {status === 'IN_GAME' && item.currentGame?.players && (
          <View style={styles.playersSection}>
            {item.currentGame.players.map((p: any, idx: number) => (
              <Text key={p.id || idx} style={styles.playerName} numberOfLines={1}>
                {p.userName || p.name}
              </Text>
            ))}
          </View>
        )}

        {/* Queue count */}
        {(item.queueCount > 0 || item.totalInQueue > 0) && (
          <View style={styles.queueSection}>
            <Text style={styles.queueIcon}>⏳</Text>
            <Text style={styles.queueCountText}>
              대기 {item.queueCount || item.totalInQueue}팀
            </Text>
          </View>
        )}

        {/* Slots info */}
        {status !== 'EMPTY' && status !== 'MAINTENANCE' && (
          <Text style={styles.slotInfo}>
            슬롯 {item.slotsUsed ?? 0}/{item.slotsTotal ?? 3}
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

        {/* Legend bar */}
        <View style={styles.legendBar}>
          {Object.entries(courtStatusLabels).map(([key, label]) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: courtStatusColors[key] }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Court grid */}
        <FlatList
          data={courts}
          renderItem={renderCourtCard}
          keyExtractor={(item, idx) => item.court?.id || item.id || String(idx)}
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
    fontVariant: ['tabular-nums'],
  },
  legendBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
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
  holderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  holderIcon: {
    fontSize: 16,
  },
  holderName: {
    fontSize: 16,
    color: '#CBD5E1',
    fontWeight: '600',
    flex: 1,
  },
  playersSection: {
    backgroundColor: '#334155',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    gap: 4,
  },
  playerName: {
    fontSize: 15,
    color: '#E2E8F0',
    fontWeight: '500',
  },
  queueSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  queueIcon: {
    fontSize: 14,
  },
  queueCountText: {
    fontSize: 14,
    color: Colors.warning,
    fontWeight: '600',
  },
  slotInfo: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
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

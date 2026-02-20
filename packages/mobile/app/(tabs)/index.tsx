import { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFacilityStore } from '../../store/facilityStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useClubStore } from '../../store/clubStore';
import { useSocketEvent, useFacilityRoom } from '../../hooks/useSocket';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

const courtStatusColors: Record<string, string> = {
  EMPTY: Colors.courtEmpty,
  HELD: Colors.courtHeld,
  IN_GAME: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

export default function BoardScreen() {
  const router = useRouter();
  const { boardData, fetchBoard, facilities, fetchFacilities, isLoading } = useFacilityStore();
  const { status: checkinStatus } = useCheckinStore();
  const { clubs } = useClubStore();

  const facilityId = checkinStatus?.facilityId || facilities[0]?.id;

  useFacilityRoom(facilityId);

  useEffect(() => {
    fetchFacilities();
  }, []);

  useEffect(() => {
    if (facilityId) {
      fetchBoard(facilityId);
    }
  }, [facilityId]);

  const refreshBoard = useCallback(() => {
    if (facilityId) fetchBoard(facilityId);
  }, [facilityId]);

  // Real-time updates
  useSocketEvent('court:statusChanged', refreshBoard);
  useSocketEvent('hold:created', refreshBoard);
  useSocketEvent('hold:released', refreshBoard);
  useSocketEvent('game:started', refreshBoard);
  useSocketEvent('game:completed', refreshBoard);
  useSocketEvent('queue:joined', refreshBoard);
  useSocketEvent('queue:left', refreshBoard);
  useSocketEvent('queue:promoted', refreshBoard);
  useSocketEvent('queue:skipped', refreshBoard);

  const onRefresh = () => {
    if (facilityId) fetchBoard(facilityId);
  };

  // Determine if a court is held by one of my clubs
  const myClubIds = clubs.map((c: any) => c.id);

  const getCourtAction = (item: any) => {
    if (item.court.status === 'EMPTY') {
      return {
        label: Strings.hold.grabSlots,
        onPress: () => router.push(`/court/${item.court.id}`),
        color: Colors.secondary,
      };
    }
    if (item.court.status === 'MAINTENANCE') {
      return null;
    }
    // Court is HELD or IN_GAME
    // Check if it's my club's hold using holdClubId
    if (item.holdClubId && myClubIds.includes(item.holdClubId)) {
      return {
        label: '운영 화면',
        onPress: () => router.push(`/court/${item.court.id}`),
        color: Colors.primary,
      };
    }
    // Another club's hold - offer queue join
    return {
      label: Strings.queue.join,
      onPress: () => router.push(`/court/${item.court.id}/queue`),
      color: Colors.warning,
    };
  };

  const renderCourtCard = ({ item }: { item: any }) => {
    const action = getCourtAction(item);

    return (
      <View style={styles.courtCard}>
        <View style={styles.courtHeader}>
          <Text style={styles.courtName}>{item.court.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: courtStatusColors[item.court.status] }]}>
            <Text style={styles.statusText}>
              {Strings.court.status[item.court.status as keyof typeof Strings.court.status]}
            </Text>
          </View>
        </View>

        {item.holdClubName && (
          <Text style={styles.clubName}>{item.holdClubName}</Text>
        )}

        {/* Slot indicator */}
        {item.court.status !== 'EMPTY' && item.court.status !== 'MAINTENANCE' && (
          <View style={styles.slotRow}>
            <Text style={styles.slotText}>
              {Strings.queue.slotStatus} {item.slotsUsed}/{item.slotsTotal}
            </Text>
            {item.queueCount > 0 && (
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>
                  {Strings.queue.queueBadge}:{item.queueCount}
                </Text>
              </View>
            )}
          </View>
        )}

        {item.currentGame && (
          <View style={styles.gameSection}>
            <Text style={styles.gameSectionTitle}>
              {Strings.game.status[item.currentGame.status as keyof typeof Strings.game.status]}
            </Text>
            <View style={styles.playerList}>
              {item.currentGame.players.map((p: any) => (
                <Text key={p.id} style={styles.playerName}>{p.userName}</Text>
              ))}
            </View>
          </View>
        )}

        {item.upcomingGames.length > 0 && (
          <View style={styles.upcomingSection}>
            <Text style={styles.upcomingTitle}>대기 {item.upcomingGames.length}게임</Text>
          </View>
        )}

        {action && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: action.color }]}
            onPress={action.onPress}
          >
            <Text style={styles.actionButtonText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (!facilityId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>체크인 후 현황판을 확인하세요</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {checkinStatus && (
        <View style={styles.checkinBanner}>
          <Text style={styles.checkinText}>📍 {checkinStatus.facilityName}</Text>
        </View>
      )}
      <FlatList
        data={boardData}
        renderItem={renderCourtCard}
        keyExtractor={(item) => item.court.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
  checkinBanner: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  checkinText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  list: {
    padding: 8,
  },
  row: {
    justifyContent: 'space-between',
  },
  courtCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    margin: 4,
    maxWidth: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  courtName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  clubName: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  slotText: {
    fontSize: 12,
    color: Colors.textLight,
    fontWeight: '500',
  },
  queueBadge: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  queueBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  gameSection: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  gameSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 4,
  },
  playerList: {
    gap: 2,
  },
  playerName: {
    fontSize: 13,
    color: Colors.text,
  },
  upcomingSection: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  upcomingTitle: {
    fontSize: 12,
    color: Colors.textLight,
  },
  actionButton: {
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});

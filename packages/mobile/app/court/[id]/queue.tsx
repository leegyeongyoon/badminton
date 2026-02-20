import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { queueApi } from '../../../services/queue';
import { useClubStore } from '../../../store/clubStore';
import { useAuthStore } from '../../../store/authStore';
import { useCourtRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Colors } from '../../../constants/colors';
import { Strings } from '../../../constants/strings';
import { showAlert, showConfirm } from '../../../utils/alert';

export default function QueueScreen() {
  const { id: courtId } = useLocalSearchParams<{ id: string }>();
  const [queueData, setQueueData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showClubModal, setShowClubModal] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { clubs, fetchClubs } = useClubStore();
  const { user } = useAuthStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useCourtRoom(courtId);

  const loadQueue = useCallback(async () => {
    if (!courtId) return;
    try {
      const { data } = await queueApi.getQueue(courtId);
      setQueueData(data);
    } catch {
      setQueueData(null);
    } finally {
      setLoading(false);
    }
  }, [courtId]);

  useEffect(() => {
    loadQueue();
    fetchClubs();
  }, [loadQueue]);

  // Socket events
  useSocketEvent('queue:joined', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('queue:left', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('queue:offerSent', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('queue:promoted', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('queue:skipped', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('hold:created', useCallback(() => loadQueue(), [loadQueue]));
  useSocketEvent('hold:released', useCallback(() => loadQueue(), [loadQueue]));

  // Countdown timer for PENDING_ACCEPT
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const myPendingEntry = queueData?.queue?.find(
      (e: any) => e.status === 'PENDING_ACCEPT' && e.acceptDeadline,
    );

    if (myPendingEntry) {
      const updateCountdown = () => {
        const remaining = Math.max(0, Math.floor(
          (new Date(myPendingEntry.acceptDeadline).getTime() - Date.now()) / 1000,
        ));
        setCountdown(remaining);
        if (remaining <= 0 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          loadQueue();
        }
      };
      updateCountdown();
      timerRef.current = setInterval(updateCountdown, 1000);
    } else {
      setCountdown(null);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [queueData]);

  const handleJoinQueue = async (clubId: string) => {
    if (!courtId) return;
    try {
      await queueApi.joinQueue(courtId, clubId);
      setShowClubModal(false);
      loadQueue();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '대기열 참가에 실패했습니다');
    }
  };

  const handleJoinAsIndividual = async () => {
    if (!courtId) return;
    try {
      await queueApi.joinQueue(courtId);
      setShowClubModal(false);
      loadQueue();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '대기열 참가에 실패했습니다');
    }
  };

  const handleLeaveQueue = async (entry: any) => {
    if (!courtId) return;
    showConfirm('대기 취소', '대기열에서 나가시겠습니까?', async () => {
      try {
        const clubId = entry.holdType === 'INDIVIDUAL' ? undefined : entry.clubId;
        await queueApi.leaveQueue(courtId, clubId);
        loadQueue();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '대기 취소에 실패했습니다');
      }
    }, Strings.queue.leave);
  };

  const handleAccept = async (entry: any) => {
    if (!courtId) return;
    try {
      const clubId = entry.holdType === 'INDIVIDUAL' ? undefined : entry.clubId;
      await queueApi.acceptOffer(courtId, clubId);
      loadQueue();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '수락에 실패했습니다');
    }
  };

  // Find my queue entry using both clubId match and userId match (for individual entries)
  const myClubIds = clubs.map((c: any) => c.id);
  const userId = user?.id;

  const isMyEntry = (entry: any): boolean => {
    if (entry.holdType === 'INDIVIDUAL' && entry.userId === userId) {
      return true;
    }
    if (entry.clubId && myClubIds.includes(entry.clubId)) {
      return true;
    }
    return false;
  };

  const myQueueEntry = queueData?.queue?.find((e: any) => isMyEntry(e));

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getEntryDisplayName = (item: any): string => {
    if (item.holdType === 'INDIVIDUAL') {
      return item.userName || '개인';
    }
    return item.clubName || '모임';
  };

  const getEntryIcon = (item: any): string => {
    if (item.holdType === 'INDIVIDUAL') {
      return '👤';
    }
    return '👥';
  };

  const renderQueueEntry = ({ item, index }: { item: any; index: number }) => {
    const isMine = isMyEntry(item);
    const isPending = item.status === 'PENDING_ACCEPT';

    return (
      <View style={[styles.queueEntry, isMine && styles.queueEntryMine]}>
        <View style={styles.positionCircle}>
          <Text style={styles.positionText}>{item.position}</Text>
        </View>
        <View style={styles.entryInfo}>
          <View style={styles.entryNameRow}>
            <Text style={styles.entryIcon}>{getEntryIcon(item)}</Text>
            <Text style={[styles.entryClubName, isMine && styles.entryClubNameMine]}>
              {getEntryDisplayName(item)}
              {isMine && ' (나)'}
            </Text>
          </View>
          <Text style={styles.entryStatus}>
            {isPending ? Strings.queue.pendingAccept : Strings.queue.waiting}
          </Text>
          {item.queuedAt && (
            <Text style={styles.entryTime}>
              {new Date(item.queuedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 부터 대기
            </Text>
          )}
        </View>
        {isMine && isPending && (
          <View style={styles.acceptSection}>
            {countdown !== null && (
              <Text style={styles.countdownText}>{formatTime(countdown)}</Text>
            )}
            <TouchableOpacity
              style={styles.acceptButton}
              onPress={() => handleAccept(item)}
            >
              <Text style={styles.acceptButtonText}>{Strings.queue.accept}</Text>
            </TouchableOpacity>
          </View>
        )}
        {isMine && !isPending && (
          <TouchableOpacity
            style={styles.leaveButton}
            onPress={() => handleLeaveQueue(item)}
          >
            <Text style={styles.leaveButtonText}>{Strings.queue.leave}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: Strings.queue.title }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{Strings.common.loading}</Text>
        </View>
      </>
    );
  }

  const hasMyEntry = queueData?.queue?.some((e: any) => isMyEntry(e));

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `${queueData?.courtName || ''} ${Strings.queue.title}` }} />
      <View style={styles.container}>
        {/* Current holder */}
        {queueData?.activeHold && (
          <View style={styles.currentHolder}>
            <Text style={styles.currentHolderLabel}>{Strings.queue.currentHolder}</Text>
            <Text style={styles.currentHolderName}>{queueData.activeHold.clubName}</Text>
            {queueData.activeHold.games && (
              <Text style={styles.currentHolderSlots}>
                {Strings.queue.slotStatus} {queueData.activeHold.games.filter((g: any) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED').length}/3
              </Text>
            )}
          </View>
        )}

        {/* Queue list */}
        <FlatList
          data={queueData?.queue || []}
          renderItem={renderQueueEntry}
          keyExtractor={(item) => item.holdId}
          contentContainerStyle={styles.queueList}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>
              {Strings.queue.title} ({queueData?.totalInQueue || 0})
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>{Strings.queue.empty}</Text>
          }
        />

        {/* Join queue button */}
        {!hasMyEntry && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.joinButton}
              onPress={() => setShowClubModal(true)}
            >
              <Text style={styles.joinButtonText}>{Strings.queue.join}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Club selection modal with individual option */}
        <Modal visible={showClubModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>참가 방법 선택</Text>

              {/* Individual join option */}
              <TouchableOpacity
                style={styles.individualOption}
                onPress={handleJoinAsIndividual}
              >
                <Text style={styles.individualIcon}>👤</Text>
                <View style={styles.individualInfo}>
                  <Text style={styles.individualText}>개인으로 참가</Text>
                  <Text style={styles.individualDesc}>모임 없이 개인으로 대기열에 참가합니다</Text>
                </View>
              </TouchableOpacity>

              {/* Club options divider */}
              {clubs.length > 0 && (
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>또는 모임으로 참가</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}

              {/* Club options */}
              {clubs.map((club: any) => (
                <TouchableOpacity
                  key={club.id}
                  style={styles.clubOption}
                  onPress={() => handleJoinQueue(club.id)}
                >
                  <Text style={styles.clubIcon}>👥</Text>
                  <Text style={styles.clubOptionText}>{club.name}</Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowClubModal(false)}
              >
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  currentHolder: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  currentHolderLabel: {
    fontSize: 12,
    color: Colors.textLight,
    marginBottom: 4,
  },
  currentHolderName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  currentHolderSlots: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  queueList: {
    padding: 16,
  },
  queueEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  queueEntryMine: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  positionCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  positionText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  entryInfo: {
    flex: 1,
  },
  entryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  entryIcon: {
    fontSize: 14,
  },
  entryClubName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  entryClubNameMine: {
    color: Colors.primary,
  },
  entryStatus: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  entryTime: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },
  acceptSection: {
    alignItems: 'center',
    gap: 4,
  },
  countdownText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.danger,
  },
  acceptButton: {
    backgroundColor: Colors.secondary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  leaveButton: {
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  leaveButtonText: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  joinButton: {
    backgroundColor: Colors.warning,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '85%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
  },
  individualOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  individualIcon: {
    fontSize: 24,
  },
  individualInfo: {
    flex: 1,
  },
  individualText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  individualDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.divider,
  },
  dividerText: {
    fontSize: 12,
    color: Colors.textLight,
  },
  clubOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 10,
  },
  clubIcon: {
    fontSize: 18,
  },
  clubOptionText: {
    fontSize: 16,
    color: Colors.text,
  },
  cancelButton: {
    marginTop: 16,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
  },
});

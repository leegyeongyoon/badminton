import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAutomatchStore } from '../../store/automatchStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useFacilityRoom, useSocketEvent } from '../../hooks/useSocket';
import { Colors } from '../../constants/colors';
import { showAlert } from '../../utils/alert';

const GAME_TYPES = [
  { key: 'SINGLES', label: '단식' },
  { key: 'DOUBLES', label: '복식' },
  { key: 'MIXED_DOUBLES', label: '혼합복식' },
];

function PulsingDot() {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.8,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.3,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [scaleAnim, opacityAnim]);

  return (
    <View style={pulseStyles.container}>
      <Animated.View
        style={[
          pulseStyles.outerDot,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      />
      <View style={pulseStyles.innerDot} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outerDot: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  innerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
});

export default function AutomatchScreen() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();
  const {
    entries,
    totalWaiting,
    isLoading,
    isJoining,
    fetchPool,
    joinPool,
    leavePool,
    updatePoolCount,
  } = useAutomatchStore();
  const [showGameTypeModal, setShowGameTypeModal] = useState(false);

  const facilityId = checkinStatus?.facilityId;

  useFacilityRoom(facilityId);

  useEffect(() => {
    if (facilityId) {
      fetchPool(facilityId);
    }
  }, [facilityId]);

  // Determine if user is currently in the pool
  const myEntry = entries.find((e) => e.userId === user?.id);

  // Socket: automatch:matched - show alert and navigate
  useSocketEvent(
    'automatch:matched',
    useCallback(
      (data: any) => {
        showAlert('매칭 완료!', `${data.courtName || '코트'}에 매칭되었습니다. 게임 정보를 확인하세요.`);
        if (facilityId) {
          fetchPool(facilityId);
        }
        router.push('/(tabs)/mygame');
      },
      [facilityId, router],
    ),
  );

  // Socket: automatch:poolUpdated - update count
  useSocketEvent(
    'automatch:poolUpdated',
    useCallback(
      (data: any) => {
        if (data.totalWaiting !== undefined) {
          updatePoolCount(data.totalWaiting);
        }
        if (facilityId) {
          fetchPool(facilityId);
        }
      },
      [facilityId],
    ),
  );

  const handleJoinPool = async (gameType: string) => {
    if (!facilityId) return;
    try {
      await joinPool(facilityId, gameType);
      setShowGameTypeModal(false);
    } catch (err: any) {
      showAlert('오류', err.message || '자동 매칭 참가에 실패했습니다');
    }
  };

  const handleLeavePool = async () => {
    if (!facilityId) return;
    try {
      await leavePool(facilityId);
      fetchPool(facilityId);
    } catch (err: any) {
      showAlert('오류', err.message || '매칭 취소에 실패했습니다');
    }
  };

  const getGameTypeLabel = (key: string): string => {
    const found = GAME_TYPES.find((gt) => gt.key === key);
    return found ? found.label : key;
  };

  const renderWaitingEntry = ({ item }: { item: any }) => {
    const isMe = item.userId === user?.id;
    return (
      <View style={[styles.waitingEntry, isMe && styles.waitingEntryMine]}>
        <View style={styles.waitingAvatar}>
          <Text style={styles.waitingAvatarText}>{item.userName?.[0] || '?'}</Text>
        </View>
        <View style={styles.waitingInfo}>
          <Text style={[styles.waitingName, isMe && styles.waitingNameMine]}>
            {item.userName}
            {isMe && ' (나)'}
          </Text>
          <Text style={styles.waitingGameType}>
            {getGameTypeLabel(item.gameType)}
          </Text>
        </View>
        <Text style={styles.waitingTime}>
          {new Date(item.joinedAt).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  if (!facilityId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📍</Text>
        <Text style={styles.emptyText}>체크인 후 자동 매칭을 이용하세요</Text>
        <Text style={styles.emptySubText}>시설에 체크인하면 자동 매칭 기능을 사용할 수 있습니다</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Facility banner */}
      <View style={styles.facilityBanner}>
        <Text style={styles.facilityIcon}>📍</Text>
        <Text style={styles.facilityName}>{checkinStatus?.facilityName}</Text>
      </View>

      {/* Waiting status card */}
      {myEntry ? (
        <View style={styles.waitingCard}>
          <PulsingDot />
          <Text style={styles.waitingTitle}>매칭 대기 중...</Text>
          <Text style={styles.waitingType}>
            {getGameTypeLabel(myEntry.gameType)}
          </Text>
          <Text style={styles.waitingCount}>
            현재 {totalWaiting}명 대기 중
          </Text>
          <TouchableOpacity
            style={styles.cancelMatchButton}
            onPress={handleLeavePool}
          >
            <Text style={styles.cancelMatchText}>매칭 취소</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.joinCard}>
          <Text style={styles.joinIcon}>🔀</Text>
          <Text style={styles.joinTitle}>자동 매칭</Text>
          <Text style={styles.joinDesc}>
            자동으로 상대를 찾아 매칭해 드립니다
          </Text>
          <View style={styles.poolStatus}>
            <Text style={styles.poolStatusText}>
              현재 대기 인원: {totalWaiting}명
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.joinPoolButton, isJoining && styles.buttonDisabled]}
            onPress={() => setShowGameTypeModal(true)}
            disabled={isJoining}
          >
            <Text style={styles.joinPoolButtonText}>
              {isJoining ? '참가 중...' : '자동 매칭 참가'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Waiting list */}
      <FlatList
        data={entries}
        renderItem={renderWaitingEntry}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          entries.length > 0 ? (
            <Text style={styles.sectionTitle}>
              대기 목록 ({entries.length})
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyListContainer}>
              <Text style={styles.emptyListText}>대기 중인 플레이어가 없습니다</Text>
            </View>
          ) : null
        }
      />

      {/* Game type selector modal */}
      <Modal visible={showGameTypeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>게임 유형 선택</Text>
            <Text style={styles.modalDesc}>
              원하는 게임 유형을 선택하세요
            </Text>
            {GAME_TYPES.map((gt) => (
              <TouchableOpacity
                key={gt.key}
                style={styles.gameTypeOption}
                onPress={() => handleJoinPool(gt.key)}
              >
                <Text style={styles.gameTypeIcon}>
                  {gt.key === 'SINGLES' ? '🏸' : gt.key === 'DOUBLES' ? '🏸🏸' : '🏸🔀'}
                </Text>
                <View style={styles.gameTypeInfo}>
                  <Text style={styles.gameTypeLabel}>{gt.label}</Text>
                  <Text style={styles.gameTypeDesc}>
                    {gt.key === 'SINGLES'
                      ? '1:1 단식 경기'
                      : gt.key === 'DOUBLES'
                        ? '2:2 복식 경기'
                        : '남녀 혼합 복식 경기'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowGameTypeModal(false)}
            >
              <Text style={styles.modalCancelText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    padding: 24,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  facilityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  facilityIcon: {
    fontSize: 14,
  },
  facilityName: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  waitingCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  waitingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  waitingType: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  waitingCount: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  cancelMatchButton: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  cancelMatchText: {
    color: Colors.danger,
    fontSize: 16,
    fontWeight: '600',
  },
  joinCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  joinIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  joinTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  joinDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
  },
  poolStatus: {
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 20,
  },
  poolStatusText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  joinPoolButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  joinPoolButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
    marginTop: 8,
  },
  waitingEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  waitingEntryMine: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  waitingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  waitingAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  waitingInfo: {
    flex: 1,
  },
  waitingName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  waitingNameMine: {
    color: Colors.primary,
  },
  waitingGameType: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  waitingTime: {
    fontSize: 12,
    color: Colors.textLight,
  },
  emptyListContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    marginBottom: 4,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  gameTypeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    gap: 12,
  },
  gameTypeIcon: {
    fontSize: 20,
  },
  gameTypeInfo: {
    flex: 1,
  },
  gameTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  gameTypeDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCancelButton: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
});

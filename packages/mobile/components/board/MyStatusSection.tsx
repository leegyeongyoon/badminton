import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTurnStore } from '../../store/turnStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { courtApi } from '../../services/court';
import { checkinApi } from '../../services/checkin';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { CountdownTimer } from '../shared/CountdownTimer';
import { PlayerAvatarRow } from '../shared/PlayerAvatarRow';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';

interface MyStatusSectionProps {
  onCheckinPress: () => void;
}

export function MyStatusSection({ onCheckinPress }: MyStatusSectionProps) {
  const { myTurns, fetchMyTurns } = useTurnStore();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();
  const [isResting, setIsResting] = useState(false);
  const [restLoading, setRestLoading] = useState(false);
  const [extendLoading, setExtendLoading] = useState(false);

  useUserRoom(user?.id);

  useEffect(() => {
    fetchMyTurns();
  }, []);

  // Socket events for real-time turn updates
  const refresh = useCallback(() => {
    fetchMyTurns();
  }, [fetchMyTurns]);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);

  const playingTurns = myTurns.filter((t) => t.status === 'PLAYING');
  const waitingTurns = myTurns.filter((t) => t.status === 'WAITING');
  const isCheckedIn = !!checkinStatus;

  const handleCompleteTurn = useCallback((turnId: string) => {
    showConfirm('게임 종료', '게임을 종료하시겠습니까?', async () => {
      try {
        await courtApi.completeTurn(turnId);
        fetchMyTurns();
        showSuccess('게임이 종료되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
      }
    }, Strings.turn.complete);
  }, [fetchMyTurns]);

  const handleCancelTurn = useCallback((turnId: string) => {
    showConfirm('순번 취소', '순번을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        fetchMyTurns();
        showSuccess('순번이 취소되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '순번 취소에 실패했습니다');
      }
    }, Strings.turn.cancel);
  }, [fetchMyTurns]);

  const handleExtendTurn = useCallback((turnId: string) => {
    showConfirm('시간 연장', '15분 연장하시겠습니까?', async () => {
      setExtendLoading(true);
      try {
        await courtApi.extendTurn(turnId, 15);
        fetchMyTurns();
        showSuccess('15분 연장되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '시간 연장에 실패했습니다');
      } finally {
        setExtendLoading(false);
      }
    }, '연장');
  }, [fetchMyTurns]);

  const handleToggleRest = useCallback(async () => {
    setRestLoading(true);
    try {
      if (isResting) {
        await checkinApi.setAvailable();
        setIsResting(false);
      } else {
        await checkinApi.setResting();
        setIsResting(true);
      }
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '상태 변경에 실패했습니다');
    } finally {
      setRestLoading(false);
    }
  }, [isResting]);

  // State 1: Not checked in - compact banner
  if (!isCheckedIn) {
    return (
      <View style={styles.notCheckedInBanner}>
        <View style={styles.bannerLeft}>
          <View style={[styles.statusDot, { backgroundColor: Colors.warning }]} />
          <Text style={styles.bannerText}>{Strings.checkin.readOnlyNotice}</Text>
        </View>
        <TouchableOpacity style={styles.qrButton} onPress={onCheckinPress}>
          <Text style={styles.qrButtonText}>QR 체크인</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // State 3: Playing - prominent green-bordered card
  if (playingTurns.length > 0) {
    const turn = playingTurns[0];
    return (
      <View style={styles.playingCard}>
        <View style={styles.playingHeader}>
          <View style={styles.playingDot} />
          <Text style={styles.playingLabel}>{Strings.mygame.inProgress}</Text>
        </View>

        <Text style={styles.playingCourtName}>{turn.courtName}</Text>

        {turn.timeLimitAt && (
          <CountdownTimer timeLimitAt={turn.timeLimitAt} mode="large" />
        )}

        <View style={styles.playingPlayersRow}>
          <PlayerAvatarRow players={turn.players} avatarSize={28} />
          <Text style={styles.playingPlayersText}>
            {turn.players.map((p) => p.userName).join(', ')}
          </Text>
        </View>

        <View style={styles.playingActions}>
          <TouchableOpacity
            style={styles.extendButton}
            onPress={() => handleExtendTurn(turn.turnId)}
            disabled={extendLoading}
          >
            {extendLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.extendButtonText}>+15분</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.completeButton, { flex: 1 }]}
            onPress={() => handleCompleteTurn(turn.turnId)}
          >
            <Text style={styles.completeButtonText}>{Strings.turn.complete}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // State 4: Waiting - orange-bordered card
  if (waitingTurns.length > 0) {
    const turn = waitingTurns[0];
    return (
      <View style={styles.waitingCard}>
        <View style={styles.waitingHeader}>
          <View style={styles.waitingHeaderLeft}>
            <View style={[styles.statusDot, { backgroundColor: Colors.warning }]} />
            <Text style={styles.waitingCourtName}>{turn.courtName}</Text>
          </View>
          <View style={styles.positionBadge}>
            <Text style={styles.positionBadgeText}>{turn.position}번째</Text>
          </View>
        </View>

        {turn.position === 1 && (
          <View style={styles.nextUpHint}>
            <Text style={styles.nextUpHintText}>다음 순번입니다</Text>
          </View>
        )}
        {turn.position > 1 && (
          <View style={styles.estimatedWait}>
            <Text style={styles.estimatedWaitLabel}>예상 대기</Text>
            <Text style={styles.estimatedWaitTime}>
              약 {(turn.position - 1) * 15}~{(turn.position - 1) * 25}분
            </Text>
          </View>
        )}

        <View style={styles.waitingPlayersRow}>
          <PlayerAvatarRow players={turn.players} avatarSize={24} />
        </View>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleCancelTurn(turn.turnId)}
        >
          <Text style={styles.cancelButtonText}>{Strings.turn.cancel}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // State 2: Checked in, no turns - compact status with rest toggle
  return (
    <View style={styles.idleCard}>
      <View style={styles.idleLeft}>
        <View style={[styles.statusDot, {
          backgroundColor: isResting ? Colors.playerResting : Colors.playerAvailable,
        }]} />
        <View>
          <Text style={styles.idleFacilityName}>{checkinStatus.facilityName}</Text>
          <Text style={styles.idleStatusText}>
            {isResting ? Strings.player.status.RESTING : Strings.player.status.AVAILABLE}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.restToggleButton,
          { backgroundColor: isResting ? Colors.secondary : Colors.playerResting },
        ]}
        onPress={handleToggleRest}
        disabled={restLoading}
      >
        {restLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.restToggleText}>
            {isResting ? Strings.player.toggleAvailable : Strings.player.toggleRest}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shared
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // State 1: Not checked in banner
  notCheckedInBanner: {
    backgroundColor: Colors.warningLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#92400E',
  },
  qrButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  qrButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // State 2: Idle (checked in, no turns)
  idleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  idleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  idleFacilityName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  idleStatusText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  restToggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 72,
    alignItems: 'center',
  },
  restToggleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // State 3: Playing card
  playingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.secondary,
    padding: 16,
    marginBottom: 12,
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  playingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.courtInGame,
  },
  playingLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.courtInGame,
  },
  playingCourtName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 12,
  },
  playingPlayersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  playingPlayersText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  playingActions: {
    flexDirection: 'row',
    gap: 10,
  },
  extendButton: {
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extendButtonText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  completeButton: {
    backgroundColor: Colors.danger,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // State 4: Waiting card
  waitingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  waitingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  waitingHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waitingCourtName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  positionBadge: {
    backgroundColor: Colors.warningLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  positionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  nextUpHint: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  nextUpHintText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500',
  },
  estimatedWait: {
    backgroundColor: Colors.warningLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  estimatedWaitLabel: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
    marginBottom: 2,
  },
  estimatedWaitTime: {
    fontSize: 20,
    color: '#92400E',
    fontWeight: '800',
  },
  waitingPlayersRow: {
    marginBottom: 12,
  },
  cancelButton: {
    backgroundColor: Colors.warning,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

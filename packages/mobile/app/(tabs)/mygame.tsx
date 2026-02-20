import { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { gameApi } from '../../services/game';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';

const gameStatusMap: Record<string, string> = {
  WAITING: Strings.mygame.waitingAssignment,
  CALLING: Strings.mygame.called,
  CONFIRMED: Strings.mygame.scheduled,
  IN_PROGRESS: Strings.mygame.inProgress,
};

const gameStatusColors: Record<string, string> = {
  WAITING: Colors.textLight,
  CALLING: Colors.warning,
  CONFIRMED: Colors.secondary,
  IN_PROGRESS: Colors.courtInGame,
};

const callStatusColors: Record<string, string> = {
  PENDING: Colors.callPending,
  ACCEPTED: Colors.callAccepted,
  DECLINED: Colors.callDeclined,
  NO_SHOW: Colors.callNoShow,
  REPLACED: Colors.callNoShow,
};

export default function MyGameScreen() {
  const { myGame, isLoading, fetchMyGame } = useGameStore();
  const { user } = useAuthStore();

  useUserRoom(user?.id);

  useEffect(() => {
    fetchMyGame();
  }, []);

  const refreshGame = useCallback(() => {
    fetchMyGame();
  }, []);

  // Listen for game-related socket events
  useSocketEvent('game:calling', refreshGame);
  useSocketEvent('game:confirmed', refreshGame);
  useSocketEvent('game:started', refreshGame);
  useSocketEvent('game:completed', refreshGame);
  useSocketEvent('notification:call', refreshGame);
  useSocketEvent('game:playerResponded', refreshGame);

  const handleAcceptCall = async () => {
    if (!myGame) return;
    try {
      await gameApi.respond(myGame.gameId, true);
      fetchMyGame();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '응답에 실패했습니다');
    }
  };

  const handleDeclineCall = async () => {
    if (!myGame) return;
    showConfirm('게임 거절', '정말 이 게임을 거절하시겠습니까?', async () => {
      try {
        await gameApi.respond(myGame.gameId, false);
        fetchMyGame();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '응답에 실패했습니다');
      }
    }, Strings.game.decline);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refreshGame} />
      }
    >
      {!myGame ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏸</Text>
          <Text style={styles.emptyText}>{Strings.mygame.noGame}</Text>
        </View>
      ) : (
        <View style={styles.gameCard}>
          {/* Status badge */}
          <View style={[styles.statusBanner, { backgroundColor: gameStatusColors[myGame.status] || Colors.primary }]}>
            <Text style={styles.statusBannerText}>
              {gameStatusMap[myGame.status] || myGame.status}
            </Text>
          </View>

          {/* Court and order info */}
          <View style={styles.gameInfo}>
            <Text style={styles.courtName}>{myGame.courtName}</Text>
            <Text style={styles.orderText}>게임 {myGame.order}</Text>
          </View>

          {/* Teammates */}
          <View style={styles.teammatesSection}>
            <Text style={styles.teammatesTitle}>팀원</Text>
            {myGame.teammates.map((p) => (
              <View key={p.id} style={styles.teammateRow}>
                <View style={[styles.callDot, { backgroundColor: callStatusColors[p.callStatus] }]} />
                <Text style={[
                  styles.teammateName,
                  p.userId === user?.id && styles.teammateNameMe,
                ]}>
                  {p.userName}
                  {p.userId === user?.id && ' (나)'}
                </Text>
                <Text style={styles.callStatusText}>
                  {Strings.game.callStatus[p.callStatus as keyof typeof Strings.game.callStatus]}
                </Text>
              </View>
            ))}
          </View>

          {/* Action buttons */}
          {myGame.status === 'CALLING' && myGame.myCallStatus === 'PENDING' && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: Colors.secondary }]}
                onPress={handleAcceptCall}
              >
                <Text style={styles.actionButtonText}>{Strings.game.accept}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: Colors.danger }]}
                onPress={handleDeclineCall}
              >
                <Text style={styles.actionButtonText}>{Strings.game.decline}</Text>
              </TouchableOpacity>
            </View>
          )}

          {myGame.status === 'CALLING' && myGame.myCallStatus === 'ACCEPTED' && (
            <View style={styles.waitingNotice}>
              <Text style={styles.waitingNoticeText}>다른 팀원 응답 대기 중...</Text>
            </View>
          )}

          {myGame.status === 'CONFIRMED' && (
            <View style={styles.waitingNotice}>
              <Text style={styles.waitingNoticeText}>게임 확정! 준비해주세요</Text>
            </View>
          )}

          {myGame.status === 'IN_PROGRESS' && (
            <View style={[styles.waitingNotice, { backgroundColor: '#E8F5E9' }]}>
              <Text style={[styles.waitingNoticeText, { color: Colors.secondary }]}>
                게임 진행 중
              </Text>
            </View>
          )}
        </View>
      )}
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
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  gameCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statusBanner: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  statusBannerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  gameInfo: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  courtName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  orderText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  teammatesSection: {
    padding: 16,
  },
  teammatesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  teammateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  callDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  teammateName: {
    fontSize: 15,
    color: Colors.text,
    flex: 1,
  },
  teammateNameMe: {
    fontWeight: '700',
    color: Colors.primary,
  },
  callStatusText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    paddingTop: 0,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  waitingNotice: {
    margin: 16,
    marginTop: 0,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
  },
  waitingNoticeText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
});

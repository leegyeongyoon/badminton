import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { courtApi } from '../../services/court';
import { checkinApi } from '../../services/checkin';
import { profileApi } from '../../services/profile';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';

const turnStatusColors: Record<string, string> = {
  WAITING: Colors.textLight,
  PLAYING: Colors.courtInGame,
  COMPLETED: Colors.secondary,
  CANCELLED: Colors.danger,
};

interface GameHistoryItem {
  id: string;
  courtName: string;
  status: string;
  gameType: string;
  startedAt: string | null;
  completedAt: string | null;
  players: { userName: string }[];
}

export default function MyTurnScreen() {
  const { myTurns, isLoading, fetchMyTurns } = useTurnStore();
  const { user } = useAuthStore();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const [isResting, setIsResting] = useState(false);
  const [restLoading, setRestLoading] = useState(false);
  const [todayGames, setTodayGames] = useState<GameHistoryItem[]>([]);

  useUserRoom(user?.id);

  useEffect(() => {
    fetchMyTurns();
    loadTodayHistory();
  }, []);

  const loadTodayHistory = async () => {
    try {
      const { data } = await profileApi.getHistory(1);
      // Filter to today's games only
      const today = new Date().toISOString().split('T')[0];
      const todayItems = (data?.items || data || []).filter((g: any) => {
        const date = (g.completedAt || g.startedAt || g.createdAt || '').split('T')[0];
        return date === today && g.status === 'COMPLETED';
      });
      setTodayGames(todayItems);
    } catch { /* silent */ }
  };

  const refresh = useCallback(() => {
    fetchMyTurns();
    loadTodayHistory();
  }, []);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);
  useSocketEvent('game:timeWarning', refresh);
  useSocketEvent('game:timeExpired', refresh);

  const handleCompleteTurn = async (turnId: string) => {
    showConfirm('게임 종료', '게임을 종료하시겠습니까?', async () => {
      try {
        await courtApi.completeTurn(turnId);
        fetchMyTurns();
        loadTodayHistory();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
      }
    }, Strings.turn.complete);
  };

  const handleCancelTurn = async (turnId: string) => {
    showConfirm('순번 취소', '순번을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        fetchMyTurns();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '순번 취소에 실패했습니다');
      }
    }, Strings.turn.cancel);
  };

  const handleToggleRest = async () => {
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
  };

  const playingTurns = myTurns.filter((t) => t.status === 'PLAYING');
  const waitingTurns = myTurns.filter((t) => t.status === 'WAITING');
  const hasTurns = myTurns.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refresh} />
      }
    >
      {/* Rest/Available toggle when no active turns */}
      {!hasTurns && checkinStatus && (
        <View style={styles.restToggleSection}>
          <View style={styles.restStatusRow}>
            <View style={[styles.restStatusDot, {
              backgroundColor: isResting ? Colors.playerResting : Colors.playerAvailable,
            }]} />
            <Text style={styles.restToggleLabel}>
              현재 상태: {isResting ? Strings.player.status.RESTING : Strings.player.status.AVAILABLE}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.restToggleButton,
              { backgroundColor: isResting ? Colors.secondary : Colors.playerResting },
            ]}
            onPress={handleToggleRest}
            disabled={restLoading}
          >
            <Text style={styles.restToggleText}>
              {isResting ? Strings.player.toggleAvailable : Strings.player.toggleRest}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Currently playing - prominent display */}
      {playingTurns.map((turn) => (
        <View key={turn.turnId} style={styles.playingCard}>
          <View style={styles.playingHeader}>
            <Text style={styles.playingLabel}>{Strings.mygame.inProgress}</Text>
          </View>

          <View style={styles.playingBody}>
            <Text style={styles.playingCourtName}>{turn.courtName}</Text>

            {/* Large timer */}
            {(turn as any).timeLimitAt && (
              <LargeTimer timeLimitAt={(turn as any).timeLimitAt} />
            )}

            {/* Players */}
            <View style={styles.playingPlayers}>
              {turn.players.map((p) => (
                <View key={p.id} style={styles.playingPlayerRow}>
                  <View style={[styles.playerAvatar, p.userId === user?.id && styles.playerAvatarMe]}>
                    <Text style={styles.playerAvatarText}>{p.userName[0]}</Text>
                  </View>
                  <Text style={[
                    styles.playingPlayerName,
                    p.userId === user?.id && styles.playerNameMe,
                  ]}>
                    {p.userName}
                    {p.userId === user?.id && ' (나)'}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.completeButton}
              onPress={() => handleCompleteTurn(turn.turnId)}
            >
              <Text style={styles.completeButtonText}>{Strings.turn.complete}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Waiting turns */}
      {waitingTurns.map((turn) => (
        <View key={turn.turnId} style={styles.waitingCard}>
          <View style={styles.waitingHeader}>
            <View style={styles.waitingHeaderLeft}>
              <View style={[styles.waitingDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.waitingLabel}>{Strings.turn.status.WAITING}</Text>
            </View>
            <Text style={styles.waitingPosition}>{turn.position}번째</Text>
          </View>

          <View style={styles.waitingBody}>
            <Text style={styles.waitingCourtName}>{turn.courtName}</Text>

            {/* Estimated wait */}
            {turn.position > 1 && (
              <View style={styles.estimatedWait}>
                <Text style={styles.estimatedWaitText}>
                  예상 대기: 약 {(turn.position - 1) * 15}~{(turn.position - 1) * 25}분
                </Text>
              </View>
            )}
            {turn.position === 1 && (
              <View style={[styles.estimatedWait, { backgroundColor: Colors.primaryLight }]}>
                <Text style={[styles.estimatedWaitText, { color: Colors.primary }]}>
                  다음 순번입니다
                </Text>
              </View>
            )}

            {/* Players */}
            <View style={styles.waitingPlayers}>
              {turn.players.map((p) => (
                <Text key={p.id} style={[
                  styles.waitingPlayerName,
                  p.userId === user?.id && styles.playerNameMe,
                ]}>
                  {p.userName}{p.userId === user?.id ? ' (나)' : ''}
                </Text>
              ))}
            </View>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => handleCancelTurn(turn.turnId)}
            >
              <Text style={styles.cancelButtonText}>{Strings.turn.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Empty state */}
      {myTurns.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏸</Text>
          <Text style={styles.emptyText}>{Strings.mygame.noGame}</Text>
        </View>
      )}

      {/* Today's game history */}
      {todayGames.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.historySectionTitle}>오늘 완료된 게임 ({todayGames.length})</Text>
          {todayGames.map((game) => (
            <View key={game.id} style={styles.historyCard}>
              <View style={styles.historyLeft}>
                <Text style={styles.historyCourtName}>{game.courtName}</Text>
                <Text style={styles.historyPlayers}>
                  {game.players.map((p) => p.userName).join(', ')}
                </Text>
              </View>
              {game.completedAt && (
                <Text style={styles.historyTime}>
                  {new Date(game.completedAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function LargeTimer({ timeLimitAt }: { timeLimitAt: string }) {
  const [remaining, setRemaining] = useState('');
  const [color, setColor] = useState(Colors.timerSafe);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const totalMs = 30 * 60 * 1000;
    const update = () => {
      const diff = new Date(timeLimitAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(Strings.timer.expired);
        setColor(Colors.timerDanger);
        setProgress(0);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      setProgress(Math.min(diff / totalMs, 1));

      if (minutes < 2) setColor(Colors.timerDanger);
      else if (minutes < 5) setColor(Colors.timerWarning);
      else setColor(Colors.timerSafe);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timeLimitAt]);

  return (
    <View style={styles.largeTimerContainer}>
      <Text style={styles.largeTimerLabel}>{Strings.timer.remaining}</Text>
      <Text style={[styles.largeTimerValue, { color }]}>{remaining}</Text>
      <View style={styles.largeTimerBar}>
        <View style={[styles.largeTimerFill, {
          width: `${progress * 100}%`,
          backgroundColor: color,
        }]} />
      </View>
    </View>
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
  // Rest toggle
  restToggleSection: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  restStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  restStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  restToggleLabel: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
  },
  restToggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  restToggleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // Playing card - prominent
  playingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: Colors.courtInGame,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  playingHeader: {
    backgroundColor: Colors.courtInGame,
    paddingVertical: 14,
    alignItems: 'center',
  },
  playingLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  playingBody: {
    padding: 20,
  },
  playingCourtName: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  // Large timer
  largeTimerContainer: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 16,
    backgroundColor: Colors.background,
    borderRadius: 12,
  },
  largeTimerLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
  },
  largeTimerValue: {
    fontSize: 40,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    marginBottom: 8,
  },
  largeTimerBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  largeTimerFill: {
    height: 6,
    borderRadius: 3,
  },
  // Playing players
  playingPlayers: {
    gap: 8,
    marginBottom: 16,
  },
  playingPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerAvatarMe: {
    backgroundColor: Colors.primary,
  },
  playerAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  playingPlayerName: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: '500',
  },
  playerNameMe: {
    fontWeight: '700',
    color: Colors.primary,
  },
  completeButton: {
    backgroundColor: Colors.danger,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  // Waiting card
  waitingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  waitingHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  waitingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warning,
  },
  waitingPosition: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  waitingBody: {
    padding: 16,
  },
  waitingCourtName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  estimatedWait: {
    backgroundColor: Colors.warningLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  estimatedWaitText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '500',
  },
  waitingPlayers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  waitingPlayerName: {
    fontSize: 14,
    color: Colors.text,
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
  // Empty state
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
  // Today's history
  historySection: {
    marginTop: 8,
  },
  historySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
  },
  historyLeft: {
    flex: 1,
  },
  historyCourtName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  historyPlayers: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  historyTime: {
    fontSize: 13,
    color: Colors.textLight,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});

import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useClubStore } from '../../store/clubStore';
import { courtApi } from '../../services/court';
import { checkinApi } from '../../services/checkin';
import { profileApi } from '../../services/profile';
import { recruitmentApi } from '../../services/recruitment';
import { clubSessionApi } from '../../services/clubSession';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { CountdownTimer } from '../../components/shared/CountdownTimer';
import { PlayerAvatarRow } from '../../components/shared/PlayerAvatarRow';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import api from '../../services/api';

interface GameHistoryItem {
  id: string;
  courtName: string;
  status: string;
  gameType: string;
  startedAt: string | null;
  completedAt: string | null;
  players: { userName: string }[];
}

interface RecruitmentItem {
  id: string;
  gameType: string;
  playersRequired: number;
  status: string;
  members: { userId: string; userName: string }[];
}

export default function ActivityScreen() {
  const router = useRouter();
  const { myTurns, isLoading, fetchMyTurns } = useTurnStore();
  const { user } = useAuthStore();
  const { status: checkinStatus } = useCheckinStore();
  const [isResting, setIsResting] = useState(false);
  const [restLoading, setRestLoading] = useState(false);
  const [todayGames, setTodayGames] = useState<GameHistoryItem[]>([]);
  const [myRecruitments, setMyRecruitments] = useState<RecruitmentItem[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const facilityId = checkinStatus?.facilityId;
  useUserRoom(user?.id);

  useEffect(() => {
    fetchMyTurns();
    loadTodayHistory();
    loadMyRecruitments();
    loadActiveClubSession();
  }, []);

  const loadTodayHistory = async () => {
    try {
      const { data } = await profileApi.getHistory(1);
      const today = new Date().toISOString().split('T')[0];
      const todayItems = (data?.items || data || []).filter((g: any) => {
        const date = (g.completedAt || g.startedAt || g.createdAt || '').split('T')[0];
        return date === today && g.status === 'COMPLETED';
      });
      setTodayGames(todayItems);
    } catch { /* silent */ }
  };

  const loadMyRecruitments = async () => {
    if (!facilityId) return;
    try {
      const { data } = await recruitmentApi.list(facilityId);
      const mine = (data || []).filter((r: any) =>
        r.members?.some((m: any) => m.userId === user?.id)
      );
      setMyRecruitments(mine);
    } catch { /* silent */ }
  };

  const loadActiveClubSession = async () => {
    try {
      const { data: clubs } = await api.get('/clubs');
      for (const club of clubs) {
        try {
          const { data: session } = await clubSessionApi.getActive(club.id);
          if (session && session.status === 'ACTIVE') {
            setActiveSession({ ...session, clubName: club.name, clubId: club.id });
            return;
          }
        } catch { /* no active session */ }
      }
      setActiveSession(null);
    } catch { setActiveSession(null); }
  };

  const refresh = useCallback(() => {
    fetchMyTurns();
    loadTodayHistory();
    loadMyRecruitments();
    loadActiveClubSession();
  }, []);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);

  const handleCompleteTurn = (turnId: string) => {
    showConfirm('게임 종료', '게임을 종료하시겠습니까?', async () => {
      try {
        await courtApi.completeTurn(turnId);
        refresh();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
      }
    }, Strings.turn.complete);
  };

  const handleCancelTurn = (turnId: string) => {
    showConfirm('순번 취소', '순번을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        refresh();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '순번 취소에 실패했습니다');
      }
    }, Strings.turn.cancel);
  };

  const handleExtendTurn = async (turnId: string) => {
    try {
      await courtApi.extendTurn(turnId, 15);
      fetchMyTurns();
      showSuccess('시간이 15분 연장되었습니다');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '시간 연장에 실패했습니다');
    }
  };

  const handleRequeue = (gameId: string) => {
    showConfirm('다시 줄서기', '같은 멤버로 다시 줄서시겠습니까?', async () => {
      try {
        await courtApi.requeueTurn(gameId);
        fetchMyTurns();
        showSuccess('다시 대기열에 등록되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.message || '다시 줄서기에 실패했습니다');
      }
    });
  };

  const loadHistory = async (page: number = 1) => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/users/me/history', { params: { page, limit: 10 } });
      const items = data?.items || data || [];
      if (page === 1) {
        setHistory(items);
      } else {
        setHistory((prev) => [...prev, ...items]);
      }
      setHasMoreHistory(items.length >= 10);
      setHistoryPage(page);
    } catch {
      if (page === 1) setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history.length === 0) {
      loadHistory(1);
    }
  };

  const handleLoadMoreHistory = () => {
    if (!historyLoading && hasMoreHistory) {
      loadHistory(historyPage + 1);
    }
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
      {/* Rest/Available toggle */}
      {!hasTurns && checkinStatus && (
        <View style={styles.restSection}>
          <View style={styles.restRow}>
            <View style={[styles.restDot, {
              backgroundColor: isResting ? Colors.playerResting : Colors.playerAvailable,
            }]} />
            <Text style={styles.restLabel}>
              현재 상태: {isResting ? Strings.player.status.RESTING : Strings.player.status.AVAILABLE}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.restButton, {
              backgroundColor: isResting ? Colors.secondary : Colors.playerResting,
            }]}
            onPress={handleToggleRest}
            disabled={restLoading}
          >
            <Text style={styles.restButtonText}>
              {isResting ? Strings.player.toggleAvailable : Strings.player.toggleRest}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Playing turns */}
      {playingTurns.map((turn) => (
        <View key={turn.turnId} style={styles.playingCard}>
          <View style={styles.playingHeader}>
            <Text style={styles.playingLabel}>{Strings.mygame.inProgress}</Text>
          </View>
          <View style={styles.playingBody}>
            <Text style={styles.playingCourtName}>{turn.courtName}</Text>
            {(turn as any).timeLimitAt && (
              <CountdownTimer timeLimitAt={(turn as any).timeLimitAt} mode="large" />
            )}
            <View style={styles.playersList}>
              {turn.players.map((p) => (
                <View key={p.id} style={styles.playerRow}>
                  <View style={[styles.playerDot, p.userId === user?.id && { backgroundColor: Colors.primary }]} />
                  <Text style={[styles.playerName, p.userId === user?.id && styles.playerNameMe]}>
                    {p.userName}{p.userId === user?.id ? ' (나)' : ''}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.playingActions}>
              <TouchableOpacity
                style={styles.extendButton}
                onPress={() => handleExtendTurn(turn.turnId)}
              >
                <Text style={styles.extendButtonText}>+15분 연장</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.completeButton, { flex: 1 }]}
                onPress={() => handleCompleteTurn(turn.turnId)}
              >
                <Text style={styles.completeButtonText}>{Strings.turn.complete}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ))}

      {/* Waiting turns */}
      {waitingTurns.map((turn) => (
        <View key={turn.turnId} style={styles.waitingCard}>
          <View style={styles.waitingHeader}>
            <View style={styles.waitingHeaderLeft}>
              <View style={[styles.restDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.waitingLabel}>{Strings.turn.status.WAITING}</Text>
            </View>
            <Text style={styles.waitingPosition}>{turn.position}번째</Text>
          </View>
          <View style={styles.waitingBody}>
            <Text style={styles.waitingCourtName}>{turn.courtName}</Text>
            {turn.position === 1 ? (
              <View style={[styles.waitHint, { backgroundColor: Colors.primaryLight }]}>
                <Text style={[styles.waitHintText, { color: Colors.primary }]}>{Strings.activity.nextTurn}</Text>
              </View>
            ) : (
              <View style={styles.waitHint}>
                <Text style={styles.waitHintText}>
                  {Strings.activity.estimatedWait}: 약 {(turn.position - 1) * 15}~{(turn.position - 1) * 25}분
                </Text>
              </View>
            )}
            <View style={styles.waitingPlayers}>
              {turn.players.map((p) => (
                <Text key={p.id} style={[styles.waitingPlayerName, p.userId === user?.id && styles.playerNameMe]}>
                  {p.userName}{p.userId === user?.id ? ' (나)' : ''}
                </Text>
              ))}
            </View>
            <TouchableOpacity style={styles.cancelButton} onPress={() => handleCancelTurn(turn.turnId)}>
              <Text style={styles.cancelButtonText}>{Strings.turn.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Active club session */}
      {activeSession && (
        <TouchableOpacity
          style={styles.sessionCard}
          onPress={() => router.push(`/club/${activeSession.clubId}/session`)}
        >
          <View style={styles.sessionHeader}>
            <View style={[styles.restDot, { backgroundColor: '#7C3AED' }]} />
            <Text style={styles.sessionTitle}>{activeSession.clubName}</Text>
          </View>
          <Text style={styles.sessionStatus}>{Strings.club.sessionActive}</Text>
        </TouchableOpacity>
      )}

      {/* My recruitment participation */}
      {myRecruitments.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.activity.recruitmentActivity}</Text>
          {myRecruitments.map((r) => (
            <View key={r.id} style={styles.recruitmentCard}>
              <Text style={styles.recruitmentType}>
                {Strings.court.gameType[r.gameType as keyof typeof Strings.court.gameType] || r.gameType}
              </Text>
              <Text style={styles.recruitmentMembers}>
                {r.members.map((m) => m.userName).join(', ')} ({r.members.length}/{r.playersRequired})
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Empty state */}
      {myTurns.length === 0 && myRecruitments.length === 0 && !activeSession && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏸</Text>
          <Text style={styles.emptyText}>{Strings.activity.noActivity}</Text>
        </View>
      )}

      {/* Today's history */}
      {todayGames.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.activity.todayHistory} ({todayGames.length})</Text>
          {todayGames.map((game) => (
            <View key={game.id} style={styles.historyCard}>
              <View style={styles.historyLeft}>
                <Text style={styles.historyCourtName}>{game.courtName}</Text>
                <Text style={styles.historyPlayers}>
                  {game.players.map((p) => p.userName).join(', ')}
                </Text>
              </View>
              <View style={styles.historyRight}>
                {game.completedAt && (
                  <Text style={styles.historyTime}>
                    {new Date(game.completedAt).toLocaleTimeString('ko-KR', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.requeueButton}
                  onPress={() => handleRequeue(game.id)}
                >
                  <Text style={styles.requeueButtonText}>다시 줄서기</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Full game history */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.historyToggleButton} onPress={handleToggleHistory}>
          <Text style={styles.historyToggleText}>
            {showHistory ? '전체 히스토리 닫기' : '전체 히스토리 보기'}
          </Text>
        </TouchableOpacity>
        {showHistory && (
          <View style={styles.fullHistoryContainer}>
            <Text style={styles.sectionTitle}>전체 히스토리</Text>
            {history.length === 0 && !historyLoading && (
              <Text style={styles.emptyHistoryText}>게임 기록이 없습니다</Text>
            )}
            {history.map((game: any, idx: number) => {
              const date = game.completedAt || game.startedAt || game.createdAt;
              const duration = game.startedAt && game.completedAt
                ? Math.round((new Date(game.completedAt).getTime() - new Date(game.startedAt).getTime()) / 60000)
                : null;
              return (
                <View key={game.id || idx} style={styles.fullHistoryCard}>
                  <View style={styles.fullHistoryTop}>
                    <Text style={styles.fullHistoryDate}>
                      {date ? new Date(date).toLocaleDateString('ko-KR', {
                        month: 'short', day: 'numeric', weekday: 'short',
                      }) : '-'}
                    </Text>
                    {game.gameType && (
                      <View style={styles.gameTypeBadge}>
                        <Text style={styles.gameTypeBadgeText}>
                          {Strings.court.gameType[game.gameType as keyof typeof Strings.court.gameType] || game.gameType}
                        </Text>
                      </View>
                    )}
                    {duration != null && (
                      <Text style={styles.fullHistoryDuration}>{duration}분</Text>
                    )}
                  </View>
                  <Text style={styles.historyCourtName}>{game.courtName || '-'}</Text>
                  <Text style={styles.historyPlayers}>
                    {(game.players || []).map((p: any) => p.userName).join(', ') || '-'}
                  </Text>
                </View>
              );
            })}
            {hasMoreHistory && history.length > 0 && (
              <TouchableOpacity
                style={styles.loadMoreButton}
                onPress={handleLoadMoreHistory}
                disabled={historyLoading}
              >
                <Text style={styles.loadMoreText}>
                  {historyLoading ? '로딩 중...' : '더 보기'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, flexGrow: 1, paddingBottom: 32 },

  // Rest toggle
  restSection: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  restDot: { width: 10, height: 10, borderRadius: 5 },
  restLabel: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  restButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  restButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Playing card
  playingCard: {
    backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 16,
    shadowColor: Colors.courtInGame, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  playingHeader: { backgroundColor: Colors.courtInGame, paddingVertical: 14, alignItems: 'center' },
  playingLabel: { color: '#fff', fontSize: 18, fontWeight: '800' },
  playingBody: { padding: 20 },
  playingCourtName: { fontSize: 24, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: 16 },
  playersList: { gap: 8, marginBottom: 16 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primaryLight },
  playerName: { fontSize: 16, color: Colors.text, fontWeight: '500' },
  playerNameMe: { fontWeight: '700', color: Colors.primary },
  completeButton: { backgroundColor: Colors.danger, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  completeButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // Waiting card
  waitingCard: {
    backgroundColor: Colors.surface, borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: Colors.warning,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  waitingHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  waitingHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitingLabel: { fontSize: 14, fontWeight: '600', color: Colors.warning },
  waitingPosition: { fontSize: 14, fontWeight: '700', color: Colors.text },
  waitingBody: { padding: 16 },
  waitingCourtName: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  waitHint: { backgroundColor: Colors.warningLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  waitHintText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  waitingPlayers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  waitingPlayerName: { fontSize: 14, color: Colors.text },
  cancelButton: { backgroundColor: Colors.warning, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Club session
  sessionCard: {
    backgroundColor: '#EDE9FE', borderRadius: 12, padding: 14, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#7C3AED',
  },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionTitle: { fontSize: 15, fontWeight: '600', color: '#7C3AED' },
  sessionStatus: { fontSize: 13, color: '#7C3AED', marginTop: 4 },

  // Sections
  section: { marginTop: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 10 },

  // Recruitment
  recruitmentCard: {
    backgroundColor: Colors.recruitmentBg, borderRadius: 10, padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.secondary + '40',
  },
  recruitmentType: { fontSize: 13, fontWeight: '600', color: Colors.secondary },
  recruitmentMembers: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  // Empty
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, color: Colors.textSecondary },

  // Playing actions row
  playingActions: { flexDirection: 'row', gap: 10 },
  extendButton: {
    backgroundColor: Colors.secondary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  extendButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // History
  historyCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 4,
  },
  historyLeft: { flex: 1 },
  historyRight: { alignItems: 'flex-end', gap: 6 },
  historyCourtName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  historyPlayers: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  historyTime: { fontSize: 13, color: Colors.textLight, fontWeight: '500', fontVariant: ['tabular-nums'] },

  // Requeue button
  requeueButton: {
    backgroundColor: Colors.primaryLight, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
  },
  requeueButtonText: { fontSize: 12, fontWeight: '600', color: Colors.primary },

  // Full history
  historyToggleButton: {
    backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  historyToggleText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  fullHistoryContainer: { marginTop: 12 },
  emptyHistoryText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  fullHistoryCard: {
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 6,
  },
  fullHistoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  fullHistoryDate: { fontSize: 12, color: Colors.textLight, fontWeight: '500' },
  gameTypeBadge: {
    backgroundColor: Colors.secondaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  gameTypeBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.secondary },
  fullHistoryDuration: { fontSize: 12, color: Colors.textSecondary },
  loadMoreButton: {
    backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
});

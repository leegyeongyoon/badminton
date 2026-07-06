import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform, useWindowDimensions, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { useSessionLiveBoard } from '../../../hooks/useSessionLiveBoard';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta } from '../../../constants/skill';
import { getGenderMeta } from '../../../constants/gender';
import { GenderMarker } from '../../../components/ui/GenderMarker';
import { palette } from '../../../constants/theme';

/**
 * 모니터링 모드 — 대형 모니터에 상시 띄우는 read-only 현황 화면.
 * 코트별 현재 게임(현재 4명 + 경과시간)을 크게, 다음 게임 대기열을 강조해 보여준다.
 * 개인화("내 차례" 등) 없음 · 소켓+7초 폴링으로 자가 새로고침 · 웹은 화면 꺼짐 방지(wake lock).
 * 진입: 운영판 헤더 "모니터 뷰" 버튼 → /session/:id/monitor.
 */
export default function MonitorScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const {
    clubName, displayCourts, playingByCourtId, queuedEntries, waiting, getPlayer, nowTs, loaded,
  } = useSessionLiveBoard(clubSessionId);

  // 웹: 화면 꺼짐 방지(best-effort). 탭이 다시 보이면 재요청.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const nav = (globalThis as any).navigator;
    const doc = (globalThis as any).document;
    if (!nav?.wakeLock || !doc) return;
    let lock: any = null;
    const request = async () => { try { lock = await nav.wakeLock.request('screen'); } catch { /* ignore */ } };
    request();
    const onVis = () => { if (doc.visibilityState === 'visible') request(); };
    doc.addEventListener('visibilitychange', onVis);
    return () => { doc.removeEventListener('visibilitychange', onVis); try { lock?.release?.(); } catch { /* ignore */ } };
  }, []);

  // 코트 열 수 — 화면 폭 + 코트 수에 맞춰. 큰 모니터는 한 줄에 여러 코트.
  const courtCount = displayCourts.length || 1;
  const maxCols = width >= 1800 ? 5 : width >= 1400 ? 4 : width >= 1000 ? 3 : width >= 640 ? 2 : 1;
  const cols = Math.min(courtCount, maxCols);
  const courtBasis = `${100 / cols - 1}%`;

  const nowClock = new Date(nowTs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  // 코트 카드 한 장
  const CourtCard = ({ court }: { court: { id: string; name: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const elapsedMin = playing?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(playing.startedAt).getTime()) / 60000)) : null;
    return (
      <View style={[styles.courtCard, { flexBasis: courtBasis as any, backgroundColor: colors.surface, borderColor: playing ? colors.warningLight : colors.border }]}>
        <View style={styles.courtHead}>
          <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          {playing ? (
            <View style={[styles.stateBadge, { backgroundColor: colors.warningLight }]}>
              <View style={[styles.dot, { backgroundColor: colors.courtInGame }]} />
              <Text style={[styles.stateText, { color: colors.warning }]}>게임 중</Text>
            </View>
          ) : (
            <View style={[styles.stateBadge, { backgroundColor: colors.secondaryLight }]}>
              <View style={[styles.dot, { backgroundColor: colors.courtEmpty }]} />
              <Text style={[styles.stateText, { color: colors.secondary }]}>비어있음</Text>
            </View>
          )}
        </View>
        {elapsedMin != null && (
          <Text style={[styles.elapsed, { color: colors.warning }]}>⏱ {elapsedMin < 1 ? '방금 시작' : `${elapsedMin}분 진행 중`}</Text>
        )}
        {playing ? (
          <View style={styles.playerList}>
            {playing.playerIds.map((pId, i) => {
              const p = getPlayer(pId);
              const skill = getSkillMeta(p?.skillLevel);
              const g = getGenderMeta(p?.gender);
              const hasSkill = !!p?.skillLevel;
              return (
                <View key={pId || i} style={[styles.playerChip, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={[styles.skillTag, hasSkill ? { backgroundColor: skill.color, borderColor: skill.color } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.skillText, { color: hasSkill ? palette.white : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
                  </View>
                  <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>{p?.userName || playing.playerNames?.[i] || '?'}</Text>
                  {g && <GenderMarker meta={g} size={20} />}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.emptyBox, { borderColor: colors.border }]}>
            <Icon name="court" size={44} color={colors.textLight} />
            <Text style={[styles.emptyText, { color: colors.textLight }]}>비어있음</Text>
          </View>
        )}
      </View>
    );
  };

  // 다음 게임 대기열 한 팀
  const QueueTeam = ({ entry, order }: { entry: any; order: number }) => (
    <View style={[styles.queueCard, { backgroundColor: colors.surface, borderColor: order === 1 ? colors.primary : colors.border }, order === 1 && { borderWidth: 3 }]}>
      <View style={styles.queueTop}>
        <View style={[styles.orderBadge, { backgroundColor: order === 1 ? colors.primary : colors.surfaceSecondary }]}>
          <Text style={[styles.orderText, { color: order === 1 ? palette.white : colors.textSecondary }]}>{order === 1 ? '다음' : order}</Text>
        </View>
        {order === 1 && <Text style={[styles.nextLabel, { color: colors.primary }]}>다음 게임</Text>}
      </View>
      <View style={styles.queueTeamPlayers}>
        {(entry.playerIds as string[]).map((pId: string, i: number) => {
          const p = getPlayer(pId);
          const skill = getSkillMeta(p?.skillLevel);
          const hasSkill = !!p?.skillLevel;
          return (
            <View key={pId || i} style={styles.queuePlayerRow}>
              <View style={[styles.skillTagSm, hasSkill ? { backgroundColor: skill.color } : { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.skillTextSm, { color: hasSkill ? palette.white : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
              </View>
              <Text style={[styles.queuePlayerName, { color: colors.text }]} numberOfLines={1}>{p?.userName || entry.playerNames?.[i] || '?'}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* 상단 바 */}
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.topLeft}>
          <View style={[styles.liveDot, { backgroundColor: '#22C55E' }]} />
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{clubName ? `${clubName} 현황` : '게임 현황'}</Text>
          <View style={[styles.livePill, { backgroundColor: colors.dangerBg ?? colors.surfaceSecondary }]}>
            <Text style={[styles.liveText, { color: colors.danger }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <Text style={[styles.clock, { color: colors.textSecondary }]}>{nowClock}</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.exitBtn} accessibilityLabel="모니터 닫기">
            <Icon name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* 코트 그리드(히어로) */}
      <View style={styles.courtsWrap}>
        {displayCourts.length === 0 ? (
          <Text style={[styles.emptyBig, { color: colors.textLight }]}>{loaded ? '지정된 코트가 없어요' : '불러오는 중…'}</Text>
        ) : (
          <View style={styles.courtsGrid}>
            {displayCourts.map((c) => <CourtCard key={c.id} court={c} />)}
          </View>
        )}
      </View>

      {/* 다음 게임 대기열(강조) */}
      <View style={[styles.queueSection, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.queueHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>다음 게임 대기열</Text>
          <Text style={[styles.waitCount, { color: colors.textSecondary }]}>대기 {waiting.length}명</Text>
        </View>
        {queuedEntries.length === 0 ? (
          <Text style={[styles.queueEmpty, { color: colors.textLight }]}>대기 중인 다음 게임이 없어요</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.queueRow}>
            {queuedEntries.map((e, i) => <QueueTeam key={e.id} entry={e} order={i + 1} />)}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // 상단 바
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  liveDot: { width: 12, height: 12, borderRadius: 6 },
  title: { fontSize: 28, fontWeight: '900', flexShrink: 1 },
  livePill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  liveText: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  clock: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exitBtn: { padding: 4 },
  // 코트 그리드
  courtsWrap: { flex: 1, padding: 16 },
  courtsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignContent: 'flex-start' },
  courtCard: { flexGrow: 1, borderWidth: 2, borderRadius: 18, padding: 16, minHeight: 200 },
  courtHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  courtName: { fontSize: 30, fontWeight: '900', flexShrink: 1 },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stateText: { fontSize: 16, fontWeight: '800' },
  elapsed: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  playerList: { gap: 8 },
  playerChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  skillTag: { minWidth: 30, height: 30, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  skillText: { fontSize: 16, fontWeight: '900' },
  playerName: { fontSize: 24, fontWeight: '800', flex: 1 },
  emptyBox: { flex: 1, minHeight: 130, borderWidth: 2, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 20, fontWeight: '700' },
  emptyBig: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 60 },
  // 다음 게임 대기열
  queueSection: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  queueHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 24, fontWeight: '900' },
  waitCount: { fontSize: 20, fontWeight: '800' },
  queueEmpty: { fontSize: 18, fontWeight: '600', paddingVertical: 20 },
  queueRow: { flexDirection: 'row', gap: 12, paddingBottom: 4 },
  queueCard: { width: 240, borderWidth: 2, borderRadius: 16, padding: 12 },
  queueTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  orderBadge: { minWidth: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  orderText: { fontSize: 16, fontWeight: '900' },
  nextLabel: { fontSize: 16, fontWeight: '900' },
  queueTeamPlayers: { gap: 6 },
  queuePlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillTagSm: { minWidth: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  skillTextSm: { fontSize: 13, fontWeight: '900' },
  queuePlayerName: { fontSize: 20, fontWeight: '700', flex: 1 },
});

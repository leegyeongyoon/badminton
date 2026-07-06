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
 * 실사용 피드백 반영: 사람들이 '대기 순서'에 가장 관심 많고, 게임 중 코트는 잘 안 본다
 * (운영자가 불러줘서 들어감). 그래서 '다음 게임 대기열 + 대기 명단'을 히어로로 크게,
 * 코트 현황은 하단 컴팩트 스트립으로 작게 보여준다.
 * 소켓+7초 폴링으로 자가 새로고침 · 웹은 화면 꺼짐 방지(wake lock).
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

  // 대기열 카드 열 수 — 히어로라 화면 폭에 맞춰 넉넉히.
  const queueCount = Math.max(queuedEntries.length, 1);
  const qMaxCols = width >= 1800 ? 5 : width >= 1400 ? 4 : width >= 1000 ? 3 : width >= 640 ? 2 : 1;
  const qCols = Math.min(queueCount, qMaxCols);
  const queueBasis = `${100 / qCols - 1.2}%`;

  const nowClock = new Date(nowTs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  // ── 다음 게임 대기열 한 팀(히어로 카드) ──
  const QueueTeam = ({ entry, order }: { entry: any; order: number }) => (
    <View style={[styles.queueCard, { flexBasis: queueBasis as any, backgroundColor: colors.surface, borderColor: order === 1 ? colors.primary : colors.border }, order === 1 && { borderWidth: 4, backgroundColor: colors.primaryBg }]}>
      <View style={styles.queueTop}>
        <View style={[styles.orderBadge, { backgroundColor: order === 1 ? colors.primary : colors.surfaceSecondary }]}>
          <Text style={[styles.orderText, { color: order === 1 ? palette.white : colors.textSecondary }]}>{order}</Text>
        </View>
        <Text style={[styles.orderLabel, { color: order === 1 ? colors.primary : colors.textSecondary }]}>
          {order === 1 ? '다음 게임' : `${order}번째`}
        </Text>
      </View>
      <View style={styles.queuePlayers}>
        {(entry.playerIds as string[]).map((pId: string, i: number) => {
          const p = getPlayer(pId);
          const skill = getSkillMeta(p?.skillLevel);
          const g = getGenderMeta(p?.gender);
          const hasSkill = !!p?.skillLevel;
          return (
            <View key={pId || i} style={[styles.qPlayerChip, { backgroundColor: colors.surfaceSecondary }]}>
              <View style={[styles.qSkill, hasSkill ? { backgroundColor: skill.color } : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={[styles.qSkillText, { color: hasSkill ? palette.white : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
              </View>
              <Text style={[styles.qName, { color: colors.text }]} numberOfLines={1}>{p?.userName || entry.playerNames?.[i] || '?'}</Text>
              {g && <GenderMarker meta={g} size={18} />}
            </View>
          );
        })}
      </View>
    </View>
  );

  // ── 코트 현황 컴팩트(하단 스트립) ──
  const CourtChip = ({ court }: { court: { id: string; name: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const elapsedMin = playing?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(playing.startedAt).getTime()) / 60000)) : null;
    return (
      <View style={[styles.courtChip, { backgroundColor: colors.surface, borderColor: playing ? colors.warningLight : colors.border }]}>
        <View style={styles.courtChipHead}>
          <Text style={[styles.courtChipName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          {playing ? (
            <Text style={[styles.courtChipElapsed, { color: colors.warning }]}>{elapsedMin != null ? (elapsedMin < 1 ? '방금' : `${elapsedMin}분`) : '게임중'}</Text>
          ) : (
            <Text style={[styles.courtChipEmpty, { color: colors.secondary }]}>비어있음</Text>
          )}
        </View>
        {playing ? (
          <Text style={[styles.courtChipPlayers, { color: colors.textSecondary }]} numberOfLines={2}>
            {playing.playerIds.map((pId, i) => getPlayer(pId)?.userName || playing.playerNames?.[i] || '?').join(' · ')}
          </Text>
        ) : (
          <Text style={[styles.courtChipPlayers, { color: colors.textLight }]}>—</Text>
        )}
      </View>
    );
  };

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

      {/* 다음 게임 대기열 (히어로) */}
      <View style={styles.heroWrap}>
        <View style={styles.heroHeader}>
          <Text style={[styles.heroTitle, { color: colors.text }]}>다음 게임 대기 순서</Text>
          <Text style={[styles.waitCount, { color: colors.textSecondary }]}>대기 {waiting.length}명</Text>
        </View>
        <ScrollView contentContainerStyle={styles.heroScroll} showsVerticalScrollIndicator={false}>
          {queuedEntries.length === 0 ? (
            <Text style={[styles.emptyBig, { color: colors.textLight }]}>{loaded ? '대기 중인 다음 게임이 없어요' : '불러오는 중…'}</Text>
          ) : (
            <View style={styles.queueGrid}>
              {queuedEntries.map((e, i) => <QueueTeam key={e.id} entry={e} order={i + 1} />)}
            </View>
          )}

          {/* 아직 편성 전 대기 인원 — 순서(적게 친 순) 칩 */}
          {waiting.length > 0 && (
            <View style={styles.waitBox}>
              <Text style={[styles.waitBoxTitle, { color: colors.textSecondary }]}>대기 중 (편성 전) · {waiting.length}명</Text>
              <View style={styles.waitChips}>
                {waiting.map((p) => {
                  const skill = getSkillMeta(p.skillLevel);
                  const g = getGenderMeta(p.gender);
                  const hasSkill = !!p.skillLevel;
                  return (
                    <View key={p.userId} style={[styles.waitChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={[styles.wSkill, hasSkill ? { backgroundColor: skill.color } : { backgroundColor: colors.surfaceSecondary }]}>
                        <Text style={[styles.wSkillText, { color: hasSkill ? palette.white : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
                      </View>
                      <Text style={[styles.wName, { color: colors.text }]} numberOfLines={1}>{p.userName}</Text>
                      {g && <GenderMarker meta={g} size={15} />}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* 코트 현황 (하단 컴팩트 스트립) */}
      <View style={[styles.courtStrip, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.stripTitle, { color: colors.textSecondary }]}>코트 현황</Text>
        {displayCourts.length === 0 ? (
          <Text style={[styles.courtChipEmpty, { color: colors.textLight }]}>{loaded ? '코트 없음' : '…'}</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.courtRow}>
            {displayCourts.map((c) => <CourtChip key={c.id} court={c} />)}
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

  // 히어로(대기 순서)
  heroWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 14 },
  heroHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  heroTitle: { fontSize: 30, fontWeight: '900' },
  waitCount: { fontSize: 22, fontWeight: '800' },
  heroScroll: { paddingBottom: 16 },
  emptyBig: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginTop: 60 },
  queueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignContent: 'flex-start' },
  queueCard: { flexGrow: 1, minWidth: 220, borderWidth: 2, borderRadius: 18, padding: 16 },
  queueTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  orderBadge: { minWidth: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  orderText: { fontSize: 24, fontWeight: '900' },
  orderLabel: { fontSize: 22, fontWeight: '900' },
  queuePlayers: { gap: 8 },
  qPlayerChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  qSkill: { minWidth: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  qSkillText: { fontSize: 16, fontWeight: '900' },
  qName: { fontSize: 24, fontWeight: '800', flex: 1 },

  // 대기 중(편성 전) 칩
  waitBox: { marginTop: 20 },
  waitBoxTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  waitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  waitChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  wSkill: { minWidth: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  wSkillText: { fontSize: 12, fontWeight: '900' },
  wName: { fontSize: 18, fontWeight: '700' },

  // 코트 현황(컴팩트 스트립)
  courtStrip: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  stripTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  courtRow: { flexDirection: 'row', gap: 10, paddingBottom: 2 },
  courtChip: { width: 200, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  courtChipHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  courtChipName: { fontSize: 18, fontWeight: '900', flexShrink: 1 },
  courtChipElapsed: { fontSize: 14, fontWeight: '800' },
  courtChipEmpty: { fontSize: 14, fontWeight: '800' },
  courtChipPlayers: { fontSize: 15, fontWeight: '600', lineHeight: 19 },
});

import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform, useWindowDimensions, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSessionLiveBoard } from '../../../hooks/useSessionLiveBoard';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta } from '../../../constants/skill';
import { getGenderMeta } from '../../../constants/gender';

/**
 * 모니터링 모드 — 대형 모니터에 상시 띄우는 read-only 현황 화면.
 * 실사용 피드백: 사람들이 '대기 순서'에 가장 관심 많고 게임 중 코트는 잘 안 본다.
 * 그리고 원거리 가시성을 위해 밝은 앱 테마 대신 '어두운 고대비(전광판)' 팔레트를 고정 사용한다.
 * 다음 게임 대기 순서를 히어로로 크게, 코트 현황은 하단 컴팩트 스트립으로.
 * 소켓+7초 폴링 자가 새로고침 · 웹 화면 꺼짐 방지(wake lock). 진입: 운영판 "모니터 뷰".
 */

// 원거리 가시성용 고정 다크 팔레트(앱 라이트/다크 테마와 무관).
const MC = {
  bg: '#0B1220',
  surface: '#161F33',
  chip: '#212C44',
  border: '#334155',
  text: '#F8FAFC',
  textDim: '#AEBBD0',
  textFaint: '#6B7A93',
  next: '#34D399',        // 다음 게임(초록)
  nextBg: '#0E3B2C',
  amber: '#FBBF24',       // 경과시간
  blue: '#60A5FA',        // 남성/빈코트
  danger: '#F87171',
  dangerBg: '#3A1518',
  // 성별 마커색(다크에서 잘 보이게 밝게)
  male: '#60A5FA',
  female: '#F472B6',
};

// 성별 텍스트 마커(GenderMarker 대신 큰 다크용).
function GMark({ gender, size = 15 }: { gender?: 'M' | 'F' | null; size?: number }) {
  if (!gender) return null;
  const m = gender === 'M';
  return <Text style={{ fontSize: size, fontWeight: '900', color: m ? MC.male : MC.female }}>{m ? '♂' : '♀'}</Text>;
}

export default function MonitorScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();

  const {
    clubName, displayCourts, playingByCourtId, queuedEntries, waiting, getPlayer, nowTs, loaded,
  } = useSessionLiveBoard(clubSessionId);

  // 웹: 화면 꺼짐 방지(best-effort).
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

  const queueCount = Math.max(queuedEntries.length, 1);
  const qMaxCols = width >= 1800 ? 5 : width >= 1300 ? 4 : width >= 900 ? 3 : width >= 600 ? 2 : 1;
  const qCols = Math.min(queueCount, qMaxCols);
  const queueBasis = `${100 / qCols - 1.2}%`;

  const nowClock = new Date(nowTs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  // ── 다음 게임 대기열 한 팀(히어로) ──
  const QueueTeam = ({ entry, order }: { entry: any; order: number }) => {
    const first = order === 1;
    return (
      <View style={[styles.qCard, { flexBasis: queueBasis as any, backgroundColor: first ? MC.nextBg : MC.surface, borderColor: first ? MC.next : MC.border, borderWidth: first ? 3 : 1.5 }]}>
        <View style={styles.qTop}>
          <View style={[styles.qBadge, { backgroundColor: first ? MC.next : MC.chip }]}>
            <Text style={[styles.qBadgeT, { color: first ? '#06281C' : MC.textDim }]}>{order}</Text>
          </View>
          <Text style={[styles.qLabel, { color: first ? MC.next : MC.textDim }]}>{first ? '다음 게임' : `${order}번째`}</Text>
        </View>
        {(entry.playerIds as string[]).map((pId: string, i: number) => {
          const p = getPlayer(pId);
          const skill = getSkillMeta(p?.skillLevel);
          const hasSkill = !!p?.skillLevel;
          return (
            <View key={pId || i} style={styles.qRow}>
              <View style={[styles.qSkill, { backgroundColor: hasSkill ? skill.color : MC.chip }]}>
                <Text style={styles.qSkillT}>{hasSkill ? skill.level : '·'}</Text>
              </View>
              <Text style={[styles.qName, { color: MC.text }]} numberOfLines={1}>{p?.userName || entry.playerNames?.[i] || '?'}</Text>
              <GMark gender={p?.gender} size={20} />
            </View>
          );
        })}
      </View>
    );
  };

  // ── 코트 현황 컴팩트(하단) ──
  const CourtChip = ({ court }: { court: { id: string; name: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const elapsedMin = playing?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(playing.startedAt).getTime()) / 60000)) : null;
    return (
      <View style={[styles.courtChip, { backgroundColor: MC.surface, borderColor: playing ? MC.amber : MC.border }]}>
        <View style={styles.courtHead}>
          <Text style={[styles.courtName, { color: MC.text }]} numberOfLines={1}>{court.name}</Text>
          {playing
            ? <Text style={[styles.courtTag, { color: MC.amber }]}>{elapsedMin != null ? (elapsedMin < 1 ? '방금' : `${elapsedMin}분`) : '게임중'}</Text>
            : <Text style={[styles.courtTag, { color: MC.textFaint }]}>비어있음</Text>}
        </View>
        <Text style={[styles.courtPlayers, { color: playing ? MC.textDim : MC.textFaint }]} numberOfLines={2}>
          {playing ? playing.playerIds.map((pId, i) => getPlayer(pId)?.userName || playing.playerNames?.[i] || '?').join(' · ') : '—'}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: MC.bg }]}>
      {/* 상단 바 */}
      <View style={[styles.topBar, { borderBottomColor: MC.border }]}>
        <View style={styles.topLeft}>
          <View style={[styles.liveDot, { backgroundColor: MC.next }]} />
          <Text style={[styles.title, { color: MC.text }]} numberOfLines={1}>{clubName ? `${clubName} 현황` : '게임 현황'}</Text>
          <View style={[styles.livePill, { backgroundColor: MC.dangerBg }]}>
            <Text style={[styles.liveText, { color: MC.danger }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <Text style={[styles.clock, { color: MC.textDim }]}>{nowClock}</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.exitBtn} accessibilityLabel="모니터 닫기">
            <Icon name="close" size={24} color={MC.textDim} />
          </Pressable>
        </View>
      </View>

      {/* 다음 게임 대기 순서 (히어로) */}
      <View style={styles.heroWrap}>
        <View style={styles.heroHeader}>
          <Text style={[styles.heroTitle, { color: MC.text }]}>다음 게임 대기 순서</Text>
          <Text style={[styles.waitCount, { color: MC.next }]}>대기 {waiting.length}명</Text>
        </View>
        <ScrollView contentContainerStyle={styles.heroScroll} showsVerticalScrollIndicator={false}>
          {queuedEntries.length === 0 ? (
            <Text style={[styles.emptyBig, { color: MC.textFaint }]}>{loaded ? '대기 중인 다음 게임이 없어요' : '불러오는 중…'}</Text>
          ) : (
            <View style={styles.qGrid}>
              {queuedEntries.map((e, i) => <QueueTeam key={e.id} entry={e} order={i + 1} />)}
            </View>
          )}

          {waiting.length > 0 && (
            <View style={styles.waitBox}>
              <Text style={[styles.waitBoxTitle, { color: MC.textDim }]}>대기 중 (편성 전) · {waiting.length}명</Text>
              <View style={styles.waitChips}>
                {waiting.map((p) => {
                  const skill = getSkillMeta(p.skillLevel);
                  const hasSkill = !!p.skillLevel;
                  return (
                    <View key={p.userId} style={[styles.waitChip, { backgroundColor: MC.chip }]}>
                      <View style={[styles.wSkill, { backgroundColor: hasSkill ? skill.color : MC.surface }]}>
                        <Text style={styles.wSkillT}>{hasSkill ? skill.level : '·'}</Text>
                      </View>
                      <Text style={[styles.wName, { color: MC.text }]} numberOfLines={1}>{p.userName}</Text>
                      <GMark gender={p.gender} size={15} />
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* 코트 현황 (하단 컴팩트) */}
      <View style={[styles.courtStrip, { borderTopColor: MC.border }]}>
        <Text style={[styles.stripTitle, { color: MC.textDim }]}>코트 현황</Text>
        {displayCourts.length === 0 ? (
          <Text style={[styles.courtTag, { color: MC.textFaint }]}>{loaded ? '코트 없음' : '…'}</Text>
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 11, borderBottomWidth: 1 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  liveDot: { width: 11, height: 11, borderRadius: 6 },
  title: { fontSize: 24, fontWeight: '900', flexShrink: 1 },
  livePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 5 },
  liveText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  clock: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exitBtn: { padding: 4 },

  // 히어로
  heroWrap: { flex: 1, paddingHorizontal: 18, paddingTop: 14 },
  heroHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  heroTitle: { fontSize: 26, fontWeight: '900' },
  waitCount: { fontSize: 20, fontWeight: '900' },
  heroScroll: { paddingBottom: 14 },
  emptyBig: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 50 },
  qGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignContent: 'flex-start' },
  qCard: { flexGrow: 1, minWidth: 220, borderRadius: 14, padding: 14 },
  qTop: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  qBadge: { minWidth: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  qBadgeT: { fontSize: 20, fontWeight: '900' },
  qLabel: { fontSize: 20, fontWeight: '900' },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
  qSkill: { minWidth: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  qSkillT: { fontSize: 17, fontWeight: '900', color: '#fff' },
  qName: { fontSize: 26, fontWeight: '800', flex: 1 },

  // 대기 중(편성 전)
  waitBox: { marginTop: 18 },
  waitBoxTitle: { fontSize: 16, fontWeight: '800', marginBottom: 9 },
  waitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  waitChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10 },
  wSkill: { minWidth: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  wSkillT: { fontSize: 13, fontWeight: '900', color: '#fff' },
  wName: { fontSize: 19, fontWeight: '800' },

  // 코트 현황 하단
  courtStrip: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  stripTitle: { fontSize: 15, fontWeight: '800', marginBottom: 7 },
  courtRow: { flexDirection: 'row', gap: 9, paddingBottom: 2 },
  courtChip: { width: 185, borderWidth: 1.5, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 8 },
  courtHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  courtName: { fontSize: 18, fontWeight: '900', flexShrink: 1 },
  courtTag: { fontSize: 14, fontWeight: '800' },
  courtPlayers: { fontSize: 15, fontWeight: '700', lineHeight: 19 },
});

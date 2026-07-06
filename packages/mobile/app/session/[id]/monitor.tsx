import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { useSessionLiveBoard } from '../../../hooks/useSessionLiveBoard';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta } from '../../../constants/skill';
import { GenderMarker } from '../../../components/ui/GenderMarker';
import { getGenderMeta } from '../../../constants/gender';

/**
 * 모니터링 모드 — 대형 모니터 상시 표시(read-only).
 * 실사용 피드백: 대기 순서가 제일 중요, 게임 중 코트는 잘 안 봄. 원거리 가시성 위해
 * '한 게임 = 한 줄(가로 밴드)'로 화면을 꽉 채워 크게 보여준다(위에 몰려 비는 문제 해결).
 * 다음 게임 대기 순서 = 히어로(밴드), 코트 현황 = 하단 얇은 스트립.
 * 소켓+7초 폴링 자가 새로고침 · 웹 화면 꺼짐 방지. 진입: 운영판 "모니터 뷰".
 */
export default function MonitorScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

  const {
    clubName, displayCourts, playingByCourtId, queuedEntries, waiting, getPlayer, nowTs, loaded,
  } = useSessionLiveBoard(clubSessionId);

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

  const nowClock = new Date(nowTs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  // 스크롤 없이 화면에 다 들어가도록 밴드 크기/개수를 화면 높이에 맞춰 자동 조절.
  // 밴드는 flex:1 로 남는 높이를 균등 분할해 채우되, 한 밴드가 너무 커지지 않게 maxHeight 로 상한.
  // 게임이 많으면 최소 높이(minBand)까지 줄여 최대한 담고, 그래도 넘치면 나머지는 '+N'.
  const reserved = 52 /*top*/ + (waiting.length > 0 ? 58 : 0) /*대기중*/ + 150 /*코트*/ + 28 /*여백*/;
  const heroH = Math.max(220, height - reserved);
  const minBand = 60;
  const maxFit = Math.max(3, Math.floor(heroH / minBand));
  const bands = queuedEntries.slice(0, maxFit);
  const overflow = queuedEntries.length - bands.length;
  // 밴드 실제 높이(=heroH/개수)를 상한(150)으로 캡 → 게임 적을 때 과대 방지.
  const bandH = Math.min(150, Math.floor((heroH - (bands.length - 1) * 10) / Math.max(bands.length, 1)));

  // 밴드 높이에 따라 글자 크기 스케일(많은 게임 = 낮은 밴드 = 작은 글자).
  const nameSize = Math.max(16, Math.min(28, Math.round(bandH * 0.24)));
  const skillSize = Math.max(24, Math.min(34, Math.round(bandH * 0.28)));
  const orderNumSize = Math.max(22, Math.min(38, Math.round(bandH * 0.32)));

  // ── 한 게임 = 한 줄(가로 밴드). 높이(bandH)를 화면에 맞춰 자동 조절. ──
  const GameBand = ({ entry, order }: { entry: any; order: number }) => {
    const first = order === 1;
    return (
      <View style={[styles.band, { height: bandH, backgroundColor: first ? colors.primaryBg : colors.surface, borderColor: first ? colors.primary : colors.border, borderWidth: first ? 3 : 1.5 }]}>
        <View style={[styles.orderCol, { borderRightColor: colors.border }]}>
          <Text style={[styles.orderNum, { fontSize: orderNumSize, lineHeight: orderNumSize + 3, color: first ? colors.primary : colors.text }]}>{order}</Text>
          <Text style={[styles.orderLabel, { color: first ? colors.primary : colors.textSecondary }]}>{first ? '다음 게임' : '번째'}</Text>
        </View>
        <View style={styles.bandPlayers}>
          {(entry.playerIds as string[]).map((pId: string, i: number) => {
            const p = getPlayer(pId);
            const skill = getSkillMeta(p?.skillLevel);
            const g = getGenderMeta(p?.gender);
            const hasSkill = !!p?.skillLevel;
            return (
              <View key={pId || i} style={styles.bandPlayer}>
                <View style={[styles.bSkill, { width: skillSize, height: skillSize, backgroundColor: hasSkill ? skill.color : colors.surfaceSecondary }]}>
                  <Text style={[styles.bSkillT, { fontSize: Math.round(skillSize * 0.5), color: hasSkill ? '#fff' : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
                </View>
                <Text style={[styles.bName, { fontSize: nameSize, color: colors.text }]} numberOfLines={1}>{p?.userName || entry.playerNames?.[i] || '?'}</Text>
                {g && <GenderMarker meta={g} size={Math.round(nameSize * 0.72)} />}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const CourtChip = ({ court }: { court: { id: string; name: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const elapsedMin = playing?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(playing.startedAt).getTime()) / 60000)) : null;
    return (
      <View style={[styles.courtChip, { backgroundColor: colors.surface, borderColor: playing ? colors.warningLight : colors.border }]}>
        <View style={styles.courtHead}>
          <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          {playing
            ? <Text style={[styles.courtTag, { color: colors.warning }]}>{elapsedMin != null ? (elapsedMin < 1 ? '방금' : `${elapsedMin}분`) : '게임중'}</Text>
            : <Text style={[styles.courtTag, { color: colors.textLight }]}>비어있음</Text>}
        </View>
        <Text style={[styles.courtPlayers, { color: playing ? colors.textSecondary : colors.textLight }]} numberOfLines={2}>
          {playing ? playing.playerIds.map((pId, i) => getPlayer(pId)?.userName || playing.playerNames?.[i] || '?').join(' · ') : '—'}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* 상단 바 */}
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.topLeft}>
          <View style={[styles.liveDot, { backgroundColor: '#22C55E' }]} />
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{clubName ? `${clubName} · 다음 게임 순서` : '다음 게임 순서'}</Text>
          <View style={[styles.livePill, { backgroundColor: colors.dangerBg ?? colors.surfaceSecondary }]}>
            <Text style={[styles.liveText, { color: colors.danger }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <Text style={[styles.waitCount, { color: colors.primary }]}>대기 {waiting.length}명</Text>
          <Text style={[styles.clock, { color: colors.textSecondary }]}>{nowClock}</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.exitBtn} accessibilityLabel="모니터 닫기">
            <Icon name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* 다음 게임 대기 순서 — 화면을 채우는 큰 밴드들 */}
      <View style={styles.hero}>
        {queuedEntries.length === 0 ? (
          <Text style={[styles.emptyBig, { color: colors.textLight }]}>{loaded ? '대기 중인 다음 게임이 없어요' : '불러오는 중…'}</Text>
        ) : (
          bands.map((e, i) => <GameBand key={e.id} entry={e} order={i + 1} />)
        )}
        {overflow > 0 && <Text style={[styles.overflow, { color: colors.textSecondary }]}>+ {overflow}게임 더 대기 중</Text>}
      </View>

      {/* 대기 중(편성 전) — 얇은 스트립 */}
      {waiting.length > 0 && (
        <View style={[styles.waitStrip, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.stripLabel, { color: colors.textSecondary }]}>대기 중 {waiting.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.waitRow}>
            {waiting.map((p) => {
              const skill = getSkillMeta(p.skillLevel);
              const hasSkill = !!p.skillLevel;
              return (
                <View key={p.userId} style={[styles.waitChip, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={[styles.wSkill, { backgroundColor: hasSkill ? skill.color : colors.surface }]}>
                    <Text style={[styles.wSkillT, { color: hasSkill ? '#fff' : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
                  </View>
                  <Text style={[styles.wName, { color: colors.text }]} numberOfLines={1}>{p.userName}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 코트 현황 — 하단 얇은 스트립 */}
      <View style={[styles.courtStrip, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.stripLabel, { color: colors.textSecondary }]}>코트</Text>
        {displayCourts.length === 0 ? (
          <Text style={[styles.courtTag, { color: colors.textLight }]}>{loaded ? '없음' : '…'}</Text>
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  liveDot: { width: 11, height: 11, borderRadius: 6 },
  title: { fontSize: 24, fontWeight: '900', flexShrink: 1 },
  livePill: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 5 },
  liveText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  waitCount: { fontSize: 22, fontWeight: '900' },
  clock: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exitBtn: { padding: 4 },

  // 히어로: 게임 밴드들(높이는 bandH 로 화면에 맞춰 계산됨). 위에서부터 채움.
  hero: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 10, justifyContent: 'center' },
  band: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, overflow: 'hidden' },
  orderCol: { width: 116, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, alignSelf: 'stretch', paddingVertical: 6 },
  orderNum: { fontWeight: '900' },
  orderLabel: { fontSize: 14, fontWeight: '900' },
  bandPlayers: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  bandPlayer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 6, minWidth: 0 },
  bSkill: { borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  bSkillT: { fontWeight: '900' },
  bName: { fontWeight: '800', flexShrink: 1 },
  emptyBig: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  overflow: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 4 },

  // 대기 중(편성 전) 얇은 스트립
  waitStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  stripLabel: { fontSize: 15, fontWeight: '900', width: 76 },
  waitRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  waitChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8 },
  wSkill: { minWidth: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  wSkillT: { fontSize: 12, fontWeight: '900' },
  wName: { fontSize: 18, fontWeight: '800' },

  // 코트 현황 하단 스트립(살짝 키움)
  courtStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 11 },
  courtRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  courtChip: { minWidth: 215, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  courtHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  courtName: { fontSize: 21, fontWeight: '900', flexShrink: 1 },
  courtTag: { fontSize: 15, fontWeight: '800' },
  courtPlayers: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
});

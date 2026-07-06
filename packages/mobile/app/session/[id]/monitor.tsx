import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, ScrollView, useWindowDimensions, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { useSessionLiveBoard } from '../../../hooks/useSessionLiveBoard';
import { clubSessionApi } from '../../../services/clubSession';
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
    clubName, displayCourts, playingByCourtId, queuedEntries, waiting, players, getPlayer, nowTs, loaded,
  } = useSessionLiveBoard(clubSessionId);

  // 체크인 QR — data URL 이미지 1회 로드(참가자가 스캔해 출석).
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!clubSessionId) return;
    let alive = true;
    clubSessionApi.getSessionQr(clubSessionId).then((res) => { if (alive) setQr(res.data?.qr ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [clubSessionId]);

  const checkedInCount = players.length; // 이 정모 체크인 전체 인원

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
  const reserved = 52 /*top*/ + (waiting.length > 0 ? 58 : 0) /*대기중*/ + 196 /*코트 카드*/ + 28 /*여백*/;
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

  const CourtCard = ({ court }: { court: { id: string; name: string } }) => {
    const playing = playingByCourtId.get(court.id);
    const elapsedMin = playing?.startedAt ? Math.max(0, Math.floor((nowTs - new Date(playing.startedAt).getTime()) / 60000)) : null;
    return (
      <View style={[styles.courtCard, { backgroundColor: playing ? colors.surface : colors.surfaceSecondary, borderColor: playing ? colors.warning : colors.border, borderWidth: playing ? 2 : 1.5 }]}>
        <View style={styles.courtHead}>
          <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          {playing
            ? <View style={[styles.courtBadge, { backgroundColor: colors.warningLight }]}><Text style={[styles.courtBadgeT, { color: colors.warning }]}>{elapsedMin != null ? (elapsedMin < 1 ? '방금' : `${elapsedMin}분`) : '게임중'}</Text></View>
            : <Text style={[styles.courtEmpty, { color: colors.textLight }]}>비어있음</Text>}
        </View>
        {playing && (
          <View style={styles.courtPlayers}>
            {playing.playerIds.map((pId, i) => {
              const p = getPlayer(pId);
              const skill = getSkillMeta(p?.skillLevel);
              const hasSkill = !!p?.skillLevel;
              return (
                <View key={pId || i} style={[styles.cPlayer, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={[styles.cSkill, { backgroundColor: hasSkill ? skill.color : colors.surface }]}>
                    <Text style={[styles.cSkillT, { color: hasSkill ? '#fff' : colors.textLight }]}>{hasSkill ? skill.level : '·'}</Text>
                  </View>
                  <Text style={[styles.cName, { color: colors.text }]} numberOfLines={1}>{p?.userName || playing.playerNames?.[i] || '?'}</Text>
                </View>
              );
            })}
          </View>
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
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{clubName ? `${clubName} · 다음 게임 순서` : '다음 게임 순서'}</Text>
          <View style={[styles.livePill, { backgroundColor: colors.dangerBg ?? colors.surfaceSecondary }]}>
            <Text style={[styles.liveText, { color: colors.danger }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <Text style={[styles.checkinCount, { color: colors.text }]}>체크인 {checkedInCount}명</Text>
          <Text style={[styles.waitCount, { color: colors.primary }]}>대기 {waiting.length}명</Text>
          <Text style={[styles.clock, { color: colors.textSecondary }]}>{nowClock}</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.exitBtn} accessibilityLabel="모니터 닫기">
            <Icon name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* 본문: [다음 게임 대기 순서 밴드] + [우측 QR/체크인 패널] */}
      <View style={styles.mainRow}>
        <View style={styles.hero}>
          {queuedEntries.length === 0 ? (
            <Text style={[styles.emptyBig, { color: colors.textLight }]}>{loaded ? '대기 중인 다음 게임이 없어요' : '불러오는 중…'}</Text>
          ) : (
            bands.map((e, i) => <GameBand key={e.id} entry={e} order={i + 1} />)
          )}
          {overflow > 0 && <Text style={[styles.overflow, { color: colors.textSecondary }]}>+ {overflow}게임 더 대기 중</Text>}
        </View>

        {/* 우측 패널: 체크인 QR + 체크인 인원 */}
        <View style={[styles.sidePanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.checkinBig, { backgroundColor: colors.primaryBg, borderColor: colors.primary }]}>
            <Text style={[styles.checkinBigLabel, { color: colors.primary }]}>현재 체크인</Text>
            <Text style={[styles.checkinBigNum, { color: colors.primary }]}>{checkedInCount}<Text style={styles.checkinBigUnit}>명</Text></Text>
          </View>
          <Text style={[styles.qrTitle, { color: colors.text }]}>출석 QR</Text>
          {qr ? (
            <View style={styles.qrBox}>
              <Image source={{ uri: qr }} style={styles.qrImg} resizeMode="contain" accessibilityLabel="출석 QR 코드" />
            </View>
          ) : (
            <View style={[styles.qrBox, styles.qrPlaceholder, { borderColor: colors.border }]}>
              <Icon name="qr" size={40} color={colors.textLight} />
            </View>
          )}
          <Text style={[styles.qrCaption, { color: colors.textSecondary }]}>스캔하면 바로 출석돼요</Text>
        </View>
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

      {/* 코트 현황 — 하단, 코트별 카드(선수 칩) */}
      <View style={[styles.courtSection, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.stripLabel, { color: colors.textSecondary }]}>코트 현황</Text>
        {displayCourts.length === 0 ? (
          <Text style={[styles.courtEmpty, { color: colors.textLight }]}>{loaded ? '없음' : '…'}</Text>
        ) : (
          <View style={styles.courtRow}>
            {displayCourts.map((c) => <CourtCard key={c.id} court={c} />)}
          </View>
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
  checkinCount: { fontSize: 22, fontWeight: '900' },
  waitCount: { fontSize: 22, fontWeight: '900' },
  clock: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  exitBtn: { padding: 4 },

  // 본문 행: 밴드 + 우측 패널
  mainRow: { flex: 1, flexDirection: 'row' },
  // 히어로: 게임 밴드들(높이는 bandH 로 화면에 맞춰 계산됨).
  hero: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 10, justifyContent: 'center' },
  // 우측 패널: QR + 체크인
  sidePanel: { width: 300, borderLeftWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 18, paddingVertical: 16 },
  checkinBig: { width: '100%', borderWidth: 2, borderRadius: 16, alignItems: 'center', paddingVertical: 14 },
  checkinBigLabel: { fontSize: 18, fontWeight: '900' },
  checkinBigNum: { fontSize: 60, fontWeight: '900', lineHeight: 66 },
  checkinBigUnit: { fontSize: 26, fontWeight: '900' },
  qrTitle: { fontSize: 22, fontWeight: '900' },
  qrBox: { backgroundColor: '#fff', borderRadius: 16, padding: 12 },
  qrImg: { width: 200, height: 200 },
  qrPlaceholder: { width: 224, height: 224, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed' },
  qrCaption: { fontSize: 17, fontWeight: '800' },
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

  // 코트 현황 — 코트별 카드(선수 칩 2x2)
  courtSection: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  courtRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  courtCard: { flex: 1, minWidth: 0, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  courtHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 },
  courtName: { fontSize: 22, fontWeight: '900', flexShrink: 1 },
  courtBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  courtBadgeT: { fontSize: 15, fontWeight: '900' },
  courtEmpty: { fontSize: 16, fontWeight: '800' },
  courtPlayers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cPlayer: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9 },
  cSkill: { minWidth: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  cSkillT: { fontSize: 14, fontWeight: '900' },
  cName: { fontSize: 19, fontWeight: '800', flexShrink: 1 },
});

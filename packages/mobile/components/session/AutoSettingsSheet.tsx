import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import {
  gameBoardApi,
  type AutoLevelSetting,
  type ResolvedAutoSettings,
  type SessionPace,
} from '../../services/gameBoard';

// ─────────────────────────────────────────────────────────────
// AI 편성 설정 — 모임 단위(운영진 모두 같은 설정). 바꾸면 바로 저장되고 다음에 짜는 게임부터 적용.
// 위에서부터: 오늘 현황 → 급수 맞추기 → 혼복 비율 → 게임 수 맞추기 → 같은 사람과 또 → 급수별 설정.
// ─────────────────────────────────────────────────────────────

const LEVEL_LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
const LEVEL_KEYS = [...LEVEL_LETTERS.map((l) => `M${l}`), ...LEVEL_LETTERS.map((l) => `F${l}`)];
const keyLabel = (k: string) => `${k[0] === 'M' ? '남' : '여'} ${k[1]}`;
// 기본값(서버 resolveAutoSettings 와 같음) — 바뀐 칸 표시용.
const levelDefault = (k: string): Required<AutoLevelSetting> => ({
  mixedPct: k === 'FF' ? 70 : null,
  up: null,
  down: null,
  games: 'normal',
});

const LEVEL_MATCH = [
  { v: 'tight', label: '딱 맞게', effect: '같은 급수~1단계 차이만 짜요. 맞는 4명이 없으면 코트에서 나올 사람을 기다려요.' },
  { v: 'normal', label: '보통', effect: '2단계 차이 판은 오늘 판의 10%까지만. 그 이상이면 조금 기다려 더 맞는 사람을 찾아요.' },
  { v: 'loose', label: '넉넉하게', effect: '2단계 차이 판을 30%까지 허용하고 빨리 돌려요.' },
  { v: 'custom', label: '직접', effect: '2단계 차이 판을 몇 %까지 허용할지 직접 정해요.' },
] as const;
const SPREAD2_OPTIONS = [0, 5, 10, 20, 30, 50];
const MIX_OPTIONS = [0, 10, 20, 30, 40, 50];
const BALANCE = [
  { v: 'auto', label: '자동', effect: '온 시간 대비 적게 친 사람을 먼저 넣되, 급수 맞추기를 더 중요하게 봐요.' },
  { v: 'gap1', label: '1판 차이까지', effect: '지금 있는 사람끼리 판수 차이를 1판 안으로 맞춰요.' },
  { v: 'gap2', label: '2판', effect: '판수 차이를 2판 안으로 맞춰요.' },
  { v: 'gap3', label: '3판', effect: '판수 차이를 3판 안으로 맞춰요.' },
] as const;
const REPEAT = [
  { v: 'normal', label: '보통', effect: '오늘 같이 친 사람은 되도록 피해요. 비슷한 급수가 적은 분(아주 높거나 낮은 급수)은 덜 피해요.' },
  { v: 'strong', label: '최대한 피하기', effect: '오늘 같이 친 사람과는 거의 다시 안 묶어요.' },
] as const;
const MIX_CYCLE: (number | null)[] = [null, 0, 30, 50, 70, 100];
const RANGE_CYCLE: (number | null)[] = [null, 0, 1, 2, 3];
const GAMES_CYCLE = ['normal', 'more', 'less'] as const;
const next = <T,>(arr: readonly T[], v: T) => arr[(arr.indexOf(v) + 1) % arr.length];

export function AutoSettingsSheet({
  clubSessionId,
  pace,
  onClose,
  onChange,
  deviceRows,
}: {
  clubSessionId: string;
  pace: SessionPace | null;
  onClose: () => void;
  onChange?: (s: ResolvedAutoSettings) => void;
  /** 이 기기에만 저장되는 시간 설정(게임 주기·다음 게임 준비) — 운영판이 넘겨줌. */
  deviceRows?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<ResolvedAutoSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [allLevels, setAllLevels] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    gameBoardApi
      .getAutoSettings(clubSessionId)
      .then(({ data }) => setS(data.resolved))
      .catch(() => setSaveState('error'));
  }, [clubSessionId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // 바꾸면 0.6초 뒤 저장(연속으로 누르면 마지막 것만).
  const update = (patch: Partial<ResolvedAutoSettings>) => {
    if (!s) return;
    const nextS = { ...s, ...patch };
    setS(nextS);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      gameBoardApi
        .saveAutoSettings(clubSessionId, nextS)
        .then(({ data }) => { setSaveState('saved'); onChange?.(data.resolved); })
        .catch(() => setSaveState('error'));
    }, 600);
  };
  const updateLevel = (k: string, patch: Partial<AutoLevelSetting>) => {
    if (!s) return;
    update({ levels: { ...s.levels, [k]: { ...s.levels[k], ...patch } as Required<AutoLevelSetting> } });
  };

  const counts = pace?.levelCounts ?? {};
  const shownKeys = useMemo(
    () =>
      LEVEL_KEYS.filter((k) => {
        if (allLevels || (counts[k] ?? 0) > 0) return true;
        const cur = s?.levels[k];
        const d = levelDefault(k);
        return !!cur && (cur.mixedPct !== d.mixedPct || cur.up !== d.up || cur.down !== d.down || cur.games !== d.games);
      }),
    [allLevels, counts, s],
  );
  const changedLevels = useMemo(() => {
    if (!s) return [] as string[];
    const out: string[] = [];
    for (const k of LEVEL_KEYS) {
      const cur = s.levels[k];
      if (!cur) continue;
      const parts: string[] = [];
      if (cur.mixedPct != null) parts.push(`혼복 ${cur.mixedPct}%`);
      if (cur.up != null) parts.push(`위로 ${cur.up}단계`);
      if (cur.down != null) parts.push(`아래로 ${cur.down}단계`);
      if (cur.games !== 'normal') parts.push(cur.games === 'more' ? '판수 많이' : '판수 적게');
      if (parts.length) out.push(`${keyLabel(k)}: ${parts.join(' · ')}`);
    }
    return out;
  }, [s]);

  const Seg = ({ label, options, value, onPick }: {
    label: string;
    options: { v: string | number; label: string }[];
    value: string | number;
    onPick: (v: any) => void;
  }) => (
    <View style={styles.segRow}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={String(o.v)}
            onPress={() => onPick(o.v)}
            style={[styles.chip, { borderColor: on ? colors.secondary : colors.border, backgroundColor: on ? colors.secondary : 'transparent' }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label} ${o.label}`}
          >
            <Text style={[styles.chipText, { color: on ? '#fff' : colors.textSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const Section = ({ title, today, effect, children }: { title: string; today?: string; effect?: string; children: ReactNode }) => (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        {!!today && <Text style={[styles.today, { color: colors.secondary }]}>{today}</Text>}
      </View>
      {children}
      {!!effect && <Text style={[styles.effect, { color: colors.textSecondary }]}>{effect}</Text>}
    </View>
  );

  const mix = pace?.mixToday;
  const sp = pace?.spreadToday;
  const spTotal = sp ? sp.reduce((a, b) => a + b, 0) : 0;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '-');
  const gm = pace?.gamesToday;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>🤖 AI 편성 설정</Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>
                우리 모임 운영진 모두에게 적용 · 바꾸면 다음에 짜는 게임부터
                {saveState === 'saving' ? ' · 저장 중…' : saveState === 'saved' ? ' · 저장됨' : saveState === 'error' ? ' · 저장 실패(다시 눌러주세요)' : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="AI 편성 설정 닫기">
              <Ionicons name="close" size={22} color={colors.textLight} />
            </Pressable>
          </View>
          {!s ? (
            <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.secondary} />
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
              {/* 오늘 현황 — 설정이 실제로 어떻게 반영되고 있는지 */}
              <View style={[styles.statBox, { backgroundColor: colors.secondaryBg }]}>
                <Text style={[styles.statTitle, { color: colors.text }]}>오늘 짠 판 (시작 + 대기)</Text>
                <Text style={[styles.statLine, { color: colors.text }]}>
                  {mix && mix.total > 0 ? `혼복 ${mix.mixed}/${mix.total}판 (${pct(mix.mixed, mix.total)})` : '아직 짠 판이 없어요'}
                </Text>
                {!!sp && spTotal > 0 && (
                  <Text style={[styles.statLine, { color: colors.text }]}>
                    {`급수 차이: 같은 급수 ${pct(sp[0], spTotal)} · 1단계 ${pct(sp[1], spTotal)} · 2단계 ${pct(sp[2], spTotal)}${sp[3] ? ` · 3단계+ ${sp[3]}판(파트너 요청)` : ''}`}
                  </Text>
                )}
                {!!gm && <Text style={[styles.statLine, { color: colors.text }]}>{`판수: 적게 친 분 ${gm.min}판 · 많이 친 분 ${gm.max}판 (대기 포함)`}</Text>}
              </View>

              <Section
                title="급수 맞추기"
                today={sp && spTotal > 0 ? `오늘 2단계 ${pct(sp[2], spTotal)}` : undefined}
                effect={LEVEL_MATCH.find((o) => o.v === s.levelMatch)?.effect}
              >
                <Seg label="급수 맞추기" options={LEVEL_MATCH.map((o) => ({ v: o.v, label: o.label }))} value={s.levelMatch} onPick={(v) => update({ levelMatch: v })} />
                {s.levelMatch === 'custom' && (
                  <View style={{ gap: 4 }}>
                    <Text style={[styles.effect, { color: colors.textSecondary }]}>2단계 차이 판 최대</Text>
                    <Seg label="2단계 차이 판 최대" options={SPREAD2_OPTIONS.map((v) => ({ v, label: `${v}%` }))} value={s.spread2MaxPct} onPick={(v) => update({ spread2MaxPct: v })} />
                  </View>
                )}
              </Section>

              <Section
                title="혼복 비율"
                today={mix && mix.total > 0 ? `오늘 ${pct(mix.mixed, mix.total)}` : undefined}
                effect={
                  s.mixedRatio === 0
                    ? '혼복은 짜지 않아요(남녀 인원이 안 맞을 때만 예외). 남복·여복 100%.'
                    : `오늘 판 중 혼복 약 ${s.mixedRatio}%, 남복·여복 ${100 - s.mixedRatio}%. 혼복을 0~10%로 낮추면 2단계 차이 판이 늘 수 있어요.`
                }
              >
                <Seg label="혼복 비율" options={MIX_OPTIONS.map((v) => ({ v, label: `${v}%` }))} value={s.mixedRatio} onPick={(v) => update({ mixedRatio: v })} />
              </Section>

              <Section
                title="게임 수 맞추기"
                today={gm ? `지금 차이 ${gm.max - gm.min}판` : undefined}
                effect={`${BALANCE.find((o) => o.v === s.gameBalance)?.effect ?? ''} 이미 친 판과 대기 게임에 잡힌 판까지 세고, 늦게 온 분은 온 시간만큼 친 걸로 봐요.${s.gameBalance !== 'auto' ? ' 급수 맞는 사람이 정말 없으면 조금 넘을 수 있어요.' : ''}`}
              >
                <Seg label="게임 수 맞추기" options={BALANCE.map((o) => ({ v: o.v, label: o.label }))} value={s.gameBalance} onPick={(v) => update({ gameBalance: v })} />
              </Section>

              <Section title="같은 사람과 또" effect={REPEAT.find((o) => o.v === s.avoidRepeat)?.effect}>
                <Seg label="같은 사람과 또" options={REPEAT.map((o) => ({ v: o.v, label: o.label }))} value={s.avoidRepeat} onPick={(v) => update({ avoidRepeat: v })} />
              </Section>

              <Section
                title="급수별 설정"
                effect="칸을 누를 때마다 값이 바뀌어요. 혼복: 그 급수 분이 혼복에 들어가는 비율 · 위로/아래로: 같은 성별 중 몇 단계 위·아래까지 같이 칠지 · 판수: 그 급수 분들 판수를 더 많이/적게."
              >
                {changedLevels.length > 0 && (
                  <Text style={[styles.changed, { color: colors.secondary }]}>{`바꾼 설정 — ${changedLevels.join(' / ')}`}</Text>
                )}
                {shownKeys.map((k) => {
                  const cur = s.levels[k] ?? levelDefault(k);
                  const cell = (text: string, active: boolean, onPress: () => void, a11y: string) => (
                    <Pressable
                      onPress={onPress}
                      style={[styles.cell, { borderColor: active ? colors.secondary : colors.border, backgroundColor: active ? colors.secondaryBg : 'transparent' }]}
                      accessibilityRole="button"
                      accessibilityLabel={a11y}
                    >
                      <Text style={[styles.cellText, { color: active ? colors.secondary : colors.textSecondary }]}>{text}</Text>
                    </Pressable>
                  );
                  return (
                    <View key={k} style={[styles.levelRow, { borderColor: colors.border }]}>
                      <Text style={[styles.levelLabel, { color: colors.text }]}>
                        {keyLabel(k)}
                        <Text style={{ color: colors.textLight, fontWeight: '500' }}>{counts[k] ? ` ${counts[k]}명` : ''}</Text>
                      </Text>
                      <View style={styles.cells}>
                        {cell(cur.mixedPct == null ? '혼복 모임대로' : `혼복 ${cur.mixedPct}%`, cur.mixedPct != null, () => updateLevel(k, { mixedPct: next(MIX_CYCLE, cur.mixedPct) }), `${keyLabel(k)} 혼복 비율 바꾸기`)}
                        {cell(cur.up == null ? '위로 제한 없음' : `위로 ${cur.up}단계`, cur.up != null, () => updateLevel(k, { up: next(RANGE_CYCLE, cur.up) }), `${keyLabel(k)} 위로 범위 바꾸기`)}
                        {cell(cur.down == null ? '아래로 제한 없음' : `아래로 ${cur.down}단계`, cur.down != null, () => updateLevel(k, { down: next(RANGE_CYCLE, cur.down) }), `${keyLabel(k)} 아래로 범위 바꾸기`)}
                        {cell(cur.games === 'more' ? '판수 많이' : cur.games === 'less' ? '판수 적게' : '판수 보통', cur.games !== 'normal', () => updateLevel(k, { games: next(GAMES_CYCLE, cur.games) }), `${keyLabel(k)} 판수 바꾸기`)}
                      </View>
                    </View>
                  );
                })}
                <Pressable onPress={() => setAllLevels((v) => !v)} accessibilityRole="button">
                  <Text style={[styles.link, { color: colors.secondary }]}>{allLevels ? '오늘 온 급수만 보기' : '모든 급수 보기'}</Text>
                </Pressable>
              </Section>

              {!!deviceRows && (
                <Section title="시간 (이 기기)">
                  {deviceRows}
                </Section>
              )}

              <Pressable
                onPress={() =>
                  update({
                    levelMatch: 'normal',
                    spread2MaxPct: 10,
                    mixedRatio: 20,
                    avoidRepeat: 'normal',
                    gameBalance: 'auto',
                    levels: Object.fromEntries(LEVEL_KEYS.map((k) => [k, levelDefault(k)])),
                  })
                }
                accessibilityRole="button"
              >
                <Text style={[styles.link, { color: colors.textLight, textAlign: 'center' }]}>기본값으로 되돌리기</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '90%', width: '100%', maxWidth: 720, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { ...typography.caption, marginTop: 2 },
  statBox: { borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statTitle: { ...typography.caption, fontWeight: '800', marginBottom: 2 },
  statLine: { ...typography.caption, fontVariant: ['tabular-nums'] },
  section: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  today: { ...typography.caption, fontWeight: '700' },
  effect: { ...typography.caption },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { ...typography.caption, fontWeight: '700' },
  changed: { ...typography.caption, fontWeight: '700' },
  levelRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, gap: 4 },
  levelLabel: { fontSize: 13, fontWeight: '800' },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  cellText: { ...typography.caption, fontWeight: '600' },
  link: { ...typography.caption, fontWeight: '700', paddingVertical: 4 },
});

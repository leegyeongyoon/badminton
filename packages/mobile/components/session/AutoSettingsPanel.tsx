import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import {
  gameBoardApi,
  type AiInsights,
  type AutoLevelSetting,
  type AutoMatchSettings,
  type ResolvedAutoSettings,
  type SessionPace,
} from '../../services/gameBoard';

// ─────────────────────────────────────────────────────────────
// AI 편성 설정 — 모임 단위(운영진 모두 같은 설정). 바꾸면 바로 저장되고 다음에 짜는 게임부터 적용.
// 위에서부터: 오늘 현황 → 'AI는 이렇게 짜요'(지금 설정을 문장으로) → 모임 전체 설정 → 급수별 설정.
// 급수별 설정은 질문형("혼복에 얼마나 넣을까요?")으로, 고르면 결과를 문장으로 다시 보여준다.
// ─────────────────────────────────────────────────────────────

const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const; // 높은 급수 → 낮은 급수
const LEVEL_KEYS = [...LETTERS.map((l) => `M${l}`), ...LETTERS.map((l) => `F${l}`)];
const genderWord = (k: string) => (k[0] === 'M' ? '남자' : '여자');
const keyLabel = (k: string) => `${genderWord(k)} ${k[1]}조`;
// 급수 글자 → 숫자(S=7 … F=1). 같이 칠 범위는 '위로/아래로 몇 단계'로 저장.
const num = (l: string) => 7 - LETTERS.indexOf(l as (typeof LETTERS)[number]);
const letter = (n: number) => LETTERS[7 - n];
// 기본값(서버 resolveAutoSettings 와 같음).
const levelDefault = (k: string): Required<AutoLevelSetting> => ({
  mixedPct: k === 'FF' ? 70 : null,
  up: null,
  down: null,
  games: 'normal',
});
const isDefault = (k: string, v: Required<AutoLevelSetting>) => {
  const d = levelDefault(k);
  return v.mixedPct === d.mixedPct && v.up === d.up && v.down === d.down && v.games === d.games;
};

const LEVEL_MATCH = [
  { v: 'tight', label: '딱 맞게', effect: '같은 급수~1단계 차이만 짜요. 맞는 4명이 없으면 코트에서 나올 사람을 기다려요.' },
  { v: 'normal', label: '보통', effect: '같은 급수~1단계 차이 위주로 짜고, 2단계 차이 판은 오늘 판의 10%까지만 짜요.' },
  { v: 'loose', label: '넉넉하게', effect: '2단계 차이 판을 30%까지 짜서 빨리 돌려요.' },
  { v: 'custom', label: '직접', effect: '2단계 차이 판을 몇 %까지 짤지 직접 정해요.' },
] as const;
const SPREAD2_OPTIONS = [0, 5, 10, 20, 30, 50];
const MIX_OPTIONS = [0, 10, 20, 30, 40, 50];
const BALANCE = [
  { v: 'auto', label: '자동', effect: '온 시간에 비해 적게 친 분을 먼저 넣어요. 급수 맞추기를 더 중요하게 봐서 1~2판 차이는 날 수 있어요.' },
  { v: 'gap1', label: '1판 차이까지', effect: '지금 있는 분들 판수 차이를 1판 안으로 맞춰요.' },
  { v: 'gap2', label: '2판', effect: '판수 차이를 2판 안으로 맞춰요.' },
  { v: 'gap3', label: '3판', effect: '판수 차이를 3판 안으로 맞춰요.' },
] as const;
const REPEAT = [
  { v: 'normal', label: '보통', effect: '오늘 같이 친 분은 되도록 피해요. 비슷한 급수가 적은 분(아주 높거나 낮은 급수)은 덜 피해요.' },
  { v: 'strong', label: '최대한 피하기', effect: '오늘 같이 친 분과는 거의 다시 안 묶어요.' },
] as const;
// 급수별 질문의 선택지 — 운영진 말로.
const MIX_CHOICES: { v: number | null; label: string }[] = [
  { v: null, label: '모임 비율대로' },
  { v: 0, label: '안 넣기' },
  { v: 30, label: '가끔 (30%)' },
  { v: 50, label: '반반 (50%)' },
  { v: 70, label: '자주 (70%)' },
  { v: 100, label: '항상' },
];
const GAMES_CHOICES = [
  { v: 'normal', label: '다른 분들과 똑같이' },
  { v: 'more', label: '조금 더 많이' },
  { v: 'less', label: '조금 적게' },
] as const;

const mixWord = (v: number | null, club: number) =>
  v == null ? `모임 비율대로(${club}%)` : v === 0 ? '혼복 안 넣기' : v === 100 ? '항상 혼복' : `혼복 ${v}%`;
// 같은 성별 중 같이 칠 급수 범위를 문장으로: "여자 E~F조와"
const rangeWord = (k: string, v: Required<AutoLevelSetting>) => {
  if (v.up == null && v.down == null) return null;
  const me = num(k[1]);
  const hi = v.up == null ? 'S' : letter(Math.min(7, me + v.up));
  const lo = v.down == null ? 'F' : letter(Math.max(1, me - v.down));
  return hi === lo ? `${genderWord(k)} ${hi}조끼리만` : `${genderWord(k)} ${hi}~${lo}조와`;
};
const levelSentence = (k: string, v: Required<AutoLevelSetting>, club: number) => {
  const parts: string[] = [];
  if (v.mixedPct != null) parts.push(mixWord(v.mixedPct, club));
  const r = rangeWord(k, v);
  if (r) parts.push(`${r} 같이 쳐요`);
  if (v.games !== 'normal') parts.push(v.games === 'more' ? '판수 조금 더 많이' : '판수 조금 적게');
  return parts.length ? parts.join(' · ') : '모임 설정대로';
};

export function AutoSettingsPanel({
  clubSessionId,
  pace,
  onChange,
}: {
  clubSessionId: string;
  pace: SessionPace | null;
  onChange?: (s: ResolvedAutoSettings) => void;
}) {
  const { colors } = useTheme();
  const [s, setS] = useState<ResolvedAutoSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [allLevels, setAllLevels] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);

  useEffect(() => {
    gameBoardApi.aiInsights(clubSessionId).then(({ data }) => setInsights(data)).catch(() => {});
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
    update({ levels: { ...s.levels, [k]: { ...(s.levels[k] ?? levelDefault(k)), ...patch } as Required<AutoLevelSetting> } });
  };

  // 추천 적용 — 설정만 바꾸고, 같은 추천은 목록에서 뺀다.
  const applyRec = (patch: AutoMatchSettings) => {
    update(patch as Partial<ResolvedAutoSettings>);
    setInsights((cur) => (cur ? { ...cur, recommendations: cur.recommendations.filter((r) => JSON.stringify(r.patch) !== JSON.stringify(patch)) } : cur));
  };

  const counts = pace?.levelCounts ?? {};
  const shownKeys = useMemo(
    () => LEVEL_KEYS.filter((k) => allLevels || (counts[k] ?? 0) > 0 || (s?.levels[k] && !isDefault(k, s.levels[k]))),
    [allLevels, counts, s],
  );

  const Seg = ({ label, options, value, onPick }: {
    label: string;
    options: { v: string | number | null; label: string }[];
    value: string | number | null;
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
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        {!!today && <Text style={[styles.today, { color: colors.secondary }]}>{today}</Text>}
      </View>
      {children}
      {!!effect && <Text style={[styles.effect, { color: colors.textSecondary }]}>{effect}</Text>}
    </View>
  );

  if (!s) {
    return saveState === 'error'
      ? <Text style={[styles.effect, { color: colors.danger }]}>설정을 불러오지 못했어요. 운영진만 볼 수 있어요.</Text>
      : <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.secondary} />;
  }

  const mix = pace?.mixToday;
  const sp = pace?.spreadToday;
  const spTotal = sp ? sp.reduce((a, b) => a + b, 0) : 0;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '-');
  const gm = pace?.gamesToday;
  const spread2 = s.levelMatch === 'tight' ? 0 : s.spread2MaxPct;
  // 급수별로 따로 정해진 것(기본값 여자 F조 혼복 70% 포함)은 'AI는 이렇게 짜요'에 문장으로.
  const customLevels = LEVEL_KEYS.filter((k) => s.levels[k] && levelSentence(k, s.levels[k], s.mixedRatio) !== '모임 설정대로');

  // 지금 설정을 문장으로 — 'AI는 이렇게 짜요'.
  const howLines = [
    s.levelMatch === 'tight'
      ? '같은 급수~1단계 차이 4명만 묶어요. 맞는 분이 없으면 코트에서 나올 분을 기다려요.'
      : `같은 급수~1단계 차이 4명을 먼저 찾고, 2단계 차이 판은 오늘 판의 ${spread2}%까지만 짜요. 3단계 이상 차이는 안 짜요.`,
    s.mixedRatio === 0 ? '남복·여복만 짜요(남녀 인원이 안 맞을 때만 혼복).' : `오늘 판 중 혼복은 약 ${s.mixedRatio}%, 나머지는 남복·여복으로 짜요.`,
    s.gameBalance === 'auto'
      ? '온 시간에 비해 적게 친 분을 먼저 넣어요.'
      : `지금 있는 분들 판수 차이를 ${s.gameBalance.slice(3)}판 안으로 맞춰요(늦게 온 분은 온 시간만큼 친 걸로 봐요).`,
    s.avoidRepeat === 'strong' ? '오늘 같이 친 분과는 거의 다시 안 묶어요.' : '오늘 같이 친 분은 되도록 피해요.',
    ...customLevels.map((k) => `${keyLabel(k)}: ${levelSentence(k, s.levels[k], s.mixedRatio)}.`),
    '📌 요청(파트너·같이 안 짜기)은 위 설정보다 먼저 지켜요.',
  ];

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.saveLine, { color: saveState === 'error' ? colors.danger : colors.textSecondary }]}>
        우리 모임 운영진 모두에게 적용돼요 · 바꾸면 다음에 짜는 게임부터
        {saveState === 'saving' ? ' · 저장 중…' : saveState === 'saved' ? ' · 저장됨 ✓' : saveState === 'error' ? ' · 저장 실패(다시 눌러주세요)' : ''}
      </Text>

      {/* 오늘 현황 — 설정이 실제로 어떻게 반영되고 있는지 */}
      <View style={[styles.statBox, { backgroundColor: colors.secondaryBg }]}>
        <Text style={[styles.statTitle, { color: colors.text }]}>오늘 짠 판 (시작한 판 + 대기 게임)</Text>
        <Text style={[styles.statLine, { color: colors.text }]}>
          {mix && mix.total > 0 ? `혼복 ${mix.mixed}/${mix.total}판 (${pct(mix.mixed, mix.total)})` : '아직 짠 판이 없어요'}
        </Text>
        {!!sp && spTotal > 0 && (
          <Text style={[styles.statLine, { color: colors.text }]}>
            {`급수 차이: 같은 급수 ${pct(sp[0], spTotal)} · 1단계 ${pct(sp[1], spTotal)} · 2단계 ${pct(sp[2], spTotal)}${sp[3] ? ` · 3단계+ ${sp[3]}판(파트너 요청)` : ''}`}
          </Text>
        )}
        {!!gm && <Text style={[styles.statLine, { color: colors.text }]}>{`판수: 가장 적게 친 분 ${gm.min}판 · 가장 많이 친 분 ${gm.max}판 (대기 포함)`}</Text>}
      </View>

      {/* 지금 설정을 문장으로 */}
      <View style={[styles.section, { borderColor: colors.secondary, backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>🤖 지금 설정이면 AI는 이렇게 짜요</Text>
        {howLines.map((l, i) => (
          <Text key={i} style={[styles.howLine, { color: colors.text }]}>{`• ${l}`}</Text>
        ))}
      </View>

      {/* AI 학습 현황 — 운영진이 고친 판·회원 반응을 보고 AI가 배우는 것 + 설정 추천 */}
      {!!insights && (
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{`📈 AI 학습 현황 (최근 ${insights.days}일)`}</Text>
          {insights.ai.total > 0 ? (
            <>
              <Text style={[styles.howLine, { color: colors.text }]}>
                {`AI가 짠 판 ${insights.ai.total}개 — 그대로 ${pct(insights.ai.kept, insights.ai.total)} · 운영진이 고침 ${pct(insights.ai.edited, insights.ai.total)} · 지움 ${pct(insights.ai.deleted, insights.ai.total)}`}
              </Text>
              {insights.ai.edited > 0 && (
                <Text style={[styles.effect, { color: colors.textSecondary }]}>
                  {`고친 판에서 운영진은 급수 차이를 ${insights.ai.tighter}번 줄이고 ${insights.ai.looser}번 늘렸어요${insights.ai.toSame + insights.ai.toMixed > 0 ? ` · 혼복→남복·여복 ${insights.ai.toSame}번, 반대 ${insights.ai.toMixed}번` : ''}. 고친 판은 '운영진이 더 나은 판'으로 AI가 매일 다시 배워요.`}
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.effect, { color: colors.textSecondary }]}>아직 AI가 짠 판 기록이 없어요. 운영진이 AI 판을 고치면 그걸 보고 배워요.</Text>
          )}
          {pace?.style && (
            <Text style={[styles.effect, { color: colors.textSecondary }]}>
              {`배운 판: 모임 기록 ${pace.style.decisions.toLocaleString()}판${pace.style.editSamples ? ` + 운영진이 고친 판 ${pace.style.editSamples}개` : ''}${pace.style.testAccuracy != null ? ` · 운영진 선택 맞힘 ${pace.style.testAccuracy}%` : ''}`}
            </Text>
          )}
          <Text style={[styles.howLine, { color: colors.text }]}>
            {insights.feedback.total > 0
              ? `회원 반응 ${insights.feedback.total}개 — 😊 ${pct(insights.feedback.GOOD, insights.feedback.total)} · 🙂 ${pct(insights.feedback.OK, insights.feedback.total)} · 😣 ${pct(insights.feedback.BAD, insights.feedback.total)}`
              : '회원 반응: 아직 없어요(경기가 끝나면 회원 앱에 "방금 경기 어땠어요?"가 떠요)'}
          </Text>
          {insights.feedback.BAD > 0 && (
            <Text style={[styles.effect, { color: colors.textSecondary }]}>
              {`아쉬웠던 이유 — 상대가 너무 셌어요 ${insights.feedback.reasons.TOO_HARD} · 너무 쉬웠어요 ${insights.feedback.reasons.TOO_EASY} · 같은 사람과 또 ${insights.feedback.reasons.REPEAT} · 오래 기다림 ${insights.feedback.reasons.WAIT}`}
            </Text>
          )}
          {insights.recommendations.map((r) => (
            <View key={JSON.stringify(r.patch)} style={[styles.rec, { backgroundColor: colors.secondaryBg }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.recTitle, { color: colors.text }]}>{`💡 ${r.text}`}</Text>
                <Text style={[styles.effect, { color: colors.textSecondary }]}>{r.why}</Text>
              </View>
              <Pressable
                onPress={() => applyRec(r.patch)}
                style={[styles.chip, { borderColor: colors.secondary, backgroundColor: colors.secondary }]}
                accessibilityRole="button"
                accessibilityLabel={`추천 적용 ${r.text}`}
              >
                <Text style={[styles.chipText, { color: '#fff' }]}>적용</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>모임 전체</Text>
      <Section
        title="급수 맞추기"
        today={sp && spTotal > 0 ? `오늘 2단계 ${pct(sp[2], spTotal)}` : undefined}
        effect={LEVEL_MATCH.find((o) => o.v === s.levelMatch)?.effect}
      >
        <Seg label="급수 맞추기" options={LEVEL_MATCH.map((o) => ({ v: o.v, label: o.label }))} value={s.levelMatch} onPick={(v) => update({ levelMatch: v })} />
        {s.levelMatch === 'custom' && (
          <View style={{ gap: 4 }}>
            <Text style={[styles.effect, { color: colors.textSecondary }]}>2단계 차이 판(예: C·C·E·E)을 오늘 판의 몇 %까지?</Text>
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
        effect={`${BALANCE.find((o) => o.v === s.gameBalance)?.effect ?? ''} 이미 친 판과 대기 게임에 잡힌 판까지 세요.`}
      >
        <Seg label="게임 수 맞추기" options={BALANCE.map((o) => ({ v: o.v, label: o.label }))} value={s.gameBalance} onPick={(v) => update({ gameBalance: v })} />
      </Section>

      <Section title="같은 사람과 또 치기" effect={REPEAT.find((o) => o.v === s.avoidRepeat)?.effect}>
        <Seg label="같은 사람과 또" options={REPEAT.map((o) => ({ v: o.v, label: o.label }))} value={s.avoidRepeat} onPick={(v) => update({ avoidRepeat: v })} />
      </Section>

      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>급수별 (특정 급수만 다르게 짜고 싶을 때)</Text>
      <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.effect, { color: colors.textSecondary }]}>
          예) 여자 F조는 혼복 위주로 · 남자 S조는 S·A조끼리만 · 초보 분들은 판수 조금 더. 따로 안 정하면 위 모임 설정대로 짜요.
        </Text>
        {shownKeys.map((k) => {
          const cur = s.levels[k] ?? levelDefault(k);
          const open = openKey === k;
          const changed = !isDefault(k, cur);
          const me = num(k[1]);
          const hiNow = cur.up == null ? null : letter(Math.min(7, me + cur.up));
          const loNow = cur.down == null ? null : letter(Math.max(1, me - cur.down));
          return (
            <View key={k} style={[styles.levelRow, { borderColor: colors.border }]}>
              <Pressable
                onPress={() => setOpenKey(open ? null : k)}
                style={styles.levelHead}
                accessibilityRole="button"
                accessibilityLabel={`${keyLabel(k)} 설정 ${open ? '접기' : '바꾸기'}`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.levelLabel, { color: colors.text }]}>
                    {keyLabel(k)}
                    <Text style={{ color: colors.textLight, fontWeight: '500' }}>{counts[k] ? ` · 오늘 ${counts[k]}명` : ''}</Text>
                  </Text>
                  <Text style={[styles.levelSentence, { color: changed ? colors.secondary : colors.textLight }]} numberOfLines={2}>
                    {levelSentence(k, cur, s.mixedRatio)}
                  </Text>
                </View>
                <Text style={[styles.link, { color: colors.secondary }]}>{open ? '접기' : '바꾸기'}</Text>
              </Pressable>
              {open && (
                <View style={styles.levelEditor}>
                  <Text style={[styles.q, { color: colors.text }]}>{`${keyLabel(k)} 분들을 혼복에 얼마나 넣을까요?`}</Text>
                  <Seg
                    label={`${keyLabel(k)} 혼복`}
                    options={MIX_CHOICES.map((o) => ({ v: o.v, label: o.v == null ? `모임 비율대로 (${s.mixedRatio}%)` : o.label }))}
                    value={cur.mixedPct}
                    onPick={(v) => updateLevel(k, { mixedPct: v })}
                  />
                  <Text style={[styles.q, { color: colors.text }]}>{`같은 ${genderWord(k)} 중 어느 급수까지 같이 칠까요?`}</Text>
                  <Text style={[styles.qHint, { color: colors.textSecondary }]}>가장 높은 상대</Text>
                  <Seg
                    label={`${keyLabel(k)} 가장 높은 상대`}
                    options={[{ v: null, label: '정하지 않음' }, ...LETTERS.filter((l) => num(l) >= me).map((l) => ({ v: l, label: `${l}조` }))]}
                    value={hiNow}
                    onPick={(v) => updateLevel(k, { up: v == null ? null : num(v) - me })}
                  />
                  <Text style={[styles.qHint, { color: colors.textSecondary }]}>가장 낮은 상대</Text>
                  <Seg
                    label={`${keyLabel(k)} 가장 낮은 상대`}
                    options={[{ v: null, label: '정하지 않음' }, ...LETTERS.filter((l) => num(l) <= me).map((l) => ({ v: l, label: `${l}조` }))]}
                    value={loNow}
                    onPick={(v) => updateLevel(k, { down: v == null ? null : me - num(v) })}
                  />
                  <Text style={[styles.q, { color: colors.text }]}>판수는요?</Text>
                  <Seg label={`${keyLabel(k)} 판수`} options={GAMES_CHOICES.map((o) => ({ v: o.v, label: o.label }))} value={cur.games} onPick={(v) => updateLevel(k, { games: v })} />
                  <Text style={[styles.result, { color: colors.secondary }]}>{`→ ${keyLabel(k)}: ${levelSentence(k, cur, s.mixedRatio)}`}</Text>
                  {changed && (
                    <Pressable onPress={() => updateLevel(k, levelDefault(k))} accessibilityRole="button">
                      <Text style={[styles.link, { color: colors.textLight }]}>이 급수는 모임 설정대로</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })}
        <Pressable onPress={() => setAllLevels((v) => !v)} accessibilityRole="button">
          <Text style={[styles.link, { color: colors.secondary }]}>{allLevels ? '오늘 온 급수만 보기' : '모든 급수 보기'}</Text>
        </Pressable>
      </View>

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
        <Text style={[styles.link, { color: colors.textLight, textAlign: 'center' }]}>전부 기본값으로 되돌리기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  saveLine: { ...typography.caption },
  statBox: { borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statTitle: { ...typography.caption, fontWeight: '800', marginBottom: 2 },
  statLine: { ...typography.caption, fontVariant: ['tabular-nums'] },
  groupTitle: { ...typography.caption, fontWeight: '800', marginTop: spacing.sm, letterSpacing: 0.3 },
  section: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  today: { ...typography.caption, fontWeight: '700' },
  effect: { ...typography.caption },
  howLine: { fontSize: 13, lineHeight: 20 },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { ...typography.caption, fontWeight: '700' },
  levelRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 6 },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  levelLabel: { fontSize: 14, fontWeight: '800' },
  levelSentence: { ...typography.caption, marginTop: 1 },
  levelEditor: { gap: 6, paddingBottom: 6 },
  q: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  qHint: { ...typography.caption },
  result: { ...typography.caption, fontWeight: '700', marginTop: 4 },
  link: { ...typography.caption, fontWeight: '700', paddingVertical: 4 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.sm, padding: spacing.sm },
  recTitle: { fontSize: 13, fontWeight: '800' },
});

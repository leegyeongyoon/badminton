import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { SKILL_LEVELS, getSkillMeta } from '../../constants/skill';
import { BackButton } from '../../components/ui/BackButton';
import {
  careerApi, CAREER_KIND_LABEL, CERT_PRESETS, AWARD_DIVISIONS, AWARD_RESULTS, type CareerEntry,
} from '../../services/coachJob';
import { coachApi, type CoachDetail } from '../../services/coach';
import { showError, showSuccess } from '../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 내 이력서(원티드식) — 완성도 게이지 + 기본 정보(출생연도·구력·급수) +
// 섹션별 경력(선수/지도/학력/자격증/입상). 유형마다 맞는 입력 필드를 준다:
//  · 자격증: 공인 스포츠지도사 프리셋 + 발급기관 + 취득연월
//  · 입상: 대회명 + 시기 + 부문(남단~혼복) + 성적(우승~입상) 칩
// 공고 지원 시 이 이력서가 공고 측에 그대로 노출된다.
// ─────────────────────────────────────────────────────────────

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const SECTIONS = ['PLAYER', 'COACH', 'EDUCATION', 'CERT', 'AWARD'] as const;

// 유형별 입력 구성 — placeholder 까지 도메인에 맞게.
const SECTION_UI: Record<string, {
  icon: string;
  hint: string;
  titlePh: string;
  orgPh: string | null; // null = org 입력 숨김
  period: 'range' | 'single' | 'none'; // 기간 형태(취득/대회는 단일 시점)
  singleLabel?: string;
}> = {
  PLAYER: { icon: 'tennisball-outline', hint: '중·고·대학·실업팀 선수 이력', titlePh: '소속·역할 (예: OO시청 실업팀 선수)', orgPh: null, period: 'range' },
  COACH: { icon: 'megaphone-outline', hint: '체육관·클럽·레슨 지도 이력', titlePh: '직책 (예: 전임 코치, 주니어 코치)', orgPh: '시설·클럽 (예: 서울배드민턴센터)', period: 'range' },
  EDUCATION: { icon: 'school-outline', hint: '체육 관련 학력', titlePh: '학교·학과 (예: OO대 체육학과)', orgPh: null, period: 'range' },
  CERT: { icon: 'ribbon-outline', hint: '국가자격(스포츠지도사)·협회 자격', titlePh: '자격증명 (아래에서 선택하거나 직접 입력)', orgPh: '발급기관 (예: 국민체육진흥공단)', period: 'single', singleLabel: '취득 시기' },
  AWARD: { icon: 'trophy-outline', hint: '대회 입상 기록', titlePh: '대회명 (예: 전국동호인배드민턴대회)', orgPh: null, period: 'single', singleLabel: '대회 시기' },
};

type Draft = CareerEntry & { _key: string };
let keySeq = 0;
const newDraft = (kind: string): Draft => ({
  _key: `d${++keySeq}`, kind, title: '', org: null, startYm: null, endYm: null, description: null, division: null, result: null,
});

export default function CoachResume() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<CoachDetail | null>(null);
  const [entries, setEntries] = useState<Draft[]>([]);

  // 기본 정보
  const [birthYear, setBirthYear] = useState('');
  const [playingYears, setPlayingYears] = useState('');
  const [skillLevel, setSkillLevel] = useState<string | null>(null);

  // 자격증 프리셋 펼침 대상 엔트리
  const [presetFor, setPresetFor] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([coachApi.me().catch(() => null), careerApi.get().catch(() => [])])
      .then(([p, career]) => {
        setProfile(p);
        if (p) {
          setBirthYear(p.birthYear != null ? String(p.birthYear) : '');
          setPlayingYears(p.playingYears != null ? String(p.playingYears) : '');
          setSkillLevel(p.skillLevel);
        }
        setEntries(career.map((e) => ({ ...e, _key: `s${++keySeq}` })));
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = (key: string, p: Partial<CareerEntry>) =>
    setEntries((prev) => prev.map((e) => (e._key === key ? { ...e, ...p } : e)));
  const remove = (key: string) => setEntries((prev) => prev.filter((e) => e._key !== key));
  const addEntry = (kind: string) => setEntries((prev) => [...prev, newDraft(kind)]);

  // 원티드식 완성도 — 채용 판단에 필요한 항목 체크리스트.
  const completion = useMemo(() => {
    const items: { label: string; done: boolean }[] = [
      { label: '사진', done: !!profile?.photoUrl },
      { label: '한 줄 소개', done: !!profile?.intro },
      { label: '출생연도', done: !!birthYear.trim() },
      { label: '구력', done: !!playingYears.trim() },
      { label: '급수', done: !!skillLevel },
      { label: '경력', done: entries.some((e) => (e.kind === 'PLAYER' || e.kind === 'COACH') && e.title.trim()) },
      { label: '자격증', done: entries.some((e) => e.kind === 'CERT' && e.title.trim()) },
      { label: '입상 기록', done: entries.some((e) => e.kind === 'AWARD' && e.title.trim()) },
    ];
    const done = items.filter((i) => i.done).length;
    return { items, pct: Math.round((done / items.length) * 100) };
  }, [profile, birthYear, playingYears, skillLevel, entries]);

  const save = async () => {
    if (birthYear.trim() && !/^(19|20)\d{2}$/.test(birthYear.trim())) { showError('출생연도는 4자리로 입력해 주세요 (예: 1990)'); return; }
    for (const e of entries) {
      if (!e.title.trim()) { showError(`${CAREER_KIND_LABEL[e.kind]}에 제목이 비어 있어요`); return; }
      if (e.startYm && !YM.test(e.startYm)) { showError('시기는 YYYY-MM 형식이에요 (예: 2018-03)'); return; }
      if (e.endYm && !YM.test(e.endYm)) { showError('종료 시기는 YYYY-MM 형식이에요'); return; }
    }
    setSaving(true);
    try {
      await coachApi.upsertMe({
        birthYear: birthYear.trim() ? Number(birthYear.trim()) : null,
        playingYears: playingYears.trim() ? Number(playingYears.trim()) : null,
        skillLevel,
      });
      const saved = await careerApi.set(entries.map(({ _key, ...e }) => ({ ...e, title: e.title.trim() })));
      setEntries(saved.map((e) => ({ ...e, _key: `s${++keySeq}` })));
      showSuccess('이력서를 저장했어요');
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }];

  if (loading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: spacing.md }}><BackButton /></View>
        <View style={[styles.center, { gap: spacing.md }]}>
          <Ionicons name="document-text-outline" size={40} color={colors.textLight} />
          <Text style={{ ...typography.subtitle1, color: colors.text }}>먼저 코치 프로필을 등록해 주세요</Text>
          <Text style={{ ...typography.caption, color: colors.textLight, textAlign: 'center' }}>
            이름·사진·활동지역 프로필을 만들면{'\n'}이력서를 붙일 수 있어요
          </Text>
          <Pressable onPress={() => router.replace('/coach/edit' as never)} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.primaryBtnText}>코치 프로필 만들기</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const renderEntry = (e: Draft) => {
    const ui = SECTION_UI[e.kind];
    return (
      <View key={e._key} style={[styles.entryCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={styles.entryHead}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => remove(e._key)} hitSlop={8}>
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
          </Pressable>
        </View>

        <TextInput
          style={inputStyle}
          value={e.title}
          onChangeText={(t) => patch(e._key, { title: t })}
          placeholder={ui.titlePh}
          placeholderTextColor={colors.textLight}
          maxLength={80}
        />

        {/* 자격증: 공인 자격 프리셋 */}
        {e.kind === 'CERT' && (
          <>
            <Pressable onPress={() => setPresetFor(presetFor === e._key ? null : e._key)} hitSlop={6}>
              <Text style={[styles.presetToggle, { color: colors.primary }]}>
                {presetFor === e._key ? '접기' : '공인 자격증에서 선택'}
              </Text>
            </Pressable>
            {presetFor === e._key && (
              <View style={styles.presetWrap}>
                {CERT_PRESETS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => { patch(e._key, { title: c, org: c.includes('협회') ? '대한배드민턴협회' : '국민체육진흥공단' }); setPresetFor(null); }}
                    style={[styles.presetChip, { backgroundColor: colors.surface, borderColor: e.title === c ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.presetChipText, { color: e.title === c ? colors.primary : colors.textSecondary }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {ui.orgPh && (
          <TextInput
            style={inputStyle}
            value={e.org ?? ''}
            onChangeText={(t) => patch(e._key, { org: t || null })}
            placeholder={ui.orgPh}
            placeholderTextColor={colors.textLight}
            maxLength={60}
          />
        )}

        {/* 입상: 부문·성적 칩 */}
        {e.kind === 'AWARD' && (
          <>
            <View style={styles.chipRow}>
              <Text style={[styles.chipRowLabel, { color: colors.textLight }]}>부문</Text>
              {AWARD_DIVISIONS.map((d) => {
                const on = e.division === d;
                return (
                  <Pressable key={d} onPress={() => patch(e._key, { division: on ? null : d })} style={[styles.miniChip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                    <Text style={[styles.miniChipText, { color: on ? '#fff' : colors.textSecondary }]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.chipRow}>
              <Text style={[styles.chipRowLabel, { color: colors.textLight }]}>성적</Text>
              {AWARD_RESULTS.map((r) => {
                const on = e.result === r;
                return (
                  <Pressable key={r} onPress={() => patch(e._key, { result: on ? null : r })} style={[styles.miniChip, { backgroundColor: on ? colors.warning : colors.surface, borderColor: on ? colors.warning : colors.border }]}>
                    <Text style={[styles.miniChipText, { color: on ? '#fff' : colors.textSecondary }]}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* 기간 — 경력은 범위(+현재), 자격증·입상은 단일 시점 */}
        {ui.period === 'range' ? (
          <View style={styles.periodRow}>
            <TextInput style={[...inputStyle, styles.flex1, styles.centerText]} value={e.startYm ?? ''} onChangeText={(t) => patch(e._key, { startYm: t || null })} placeholder="2018-03" placeholderTextColor={colors.textLight} maxLength={7} />
            <Text style={{ color: colors.textLight }}>~</Text>
            <TextInput style={[...inputStyle, styles.flex1, styles.centerText, e.endYm === null && { opacity: 0.5 }]} value={e.endYm ?? ''} onChangeText={(t) => patch(e._key, { endYm: t || null })} placeholder="현재" placeholderTextColor={colors.textLight} maxLength={7} />
            <Pressable onPress={() => patch(e._key, { endYm: null })} style={[styles.nowChip, { backgroundColor: e.endYm === null ? colors.primary + '16' : colors.surface, borderColor: e.endYm === null ? colors.primary : colors.border }]}>
              <Text style={[styles.miniChipText, { color: e.endYm === null ? colors.primary : colors.textLight }]}>현재</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.periodRow}>
            <Text style={[styles.chipRowLabel, { color: colors.textLight }]}>{ui.singleLabel}</Text>
            <TextInput style={[...inputStyle, { width: 120 }, styles.centerText]} value={e.startYm ?? ''} onChangeText={(t) => patch(e._key, { startYm: t || null })} placeholder="2020-05" placeholderTextColor={colors.textLight} maxLength={7} />
          </View>
        )}

        {(e.kind === 'PLAYER' || e.kind === 'COACH') && (
          <TextInput
            style={[...inputStyle, styles.multiline]}
            value={e.description ?? ''}
            onChangeText={(t) => patch(e._key, { description: t || null })}
            placeholder="설명 (선택 — 담당 역할, 지도 대상, 성과 등)"
            placeholderTextColor={colors.textLight}
            multiline
            maxLength={300}
          />
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>내 이력서</Text>
        <Pressable onPress={() => router.push(`/coach/${profile.id}` as never)} hitSlop={8}>
          <Text style={[styles.previewLink, { color: colors.primary }]}>미리보기</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 완성도 게이지 — 원티드식 */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <View style={styles.gaugeHead}>
            <Text style={[styles.gaugeTitle, { color: colors.text }]}>이력서 완성도</Text>
            <Text style={[styles.gaugePct, { color: completion.pct >= 80 ? colors.secondary : colors.primary }]}>{completion.pct}%</Text>
          </View>
          <View style={[styles.gaugeTrack, { backgroundColor: colors.background }]}>
            <View style={[styles.gaugeFill, { width: `${completion.pct}%`, backgroundColor: completion.pct >= 80 ? colors.secondary : colors.primary }]} />
          </View>
          <View style={styles.gaugeItems}>
            {completion.items.map((i) => (
              <View key={i.label} style={styles.gaugeItem}>
                <Ionicons name={i.done ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={i.done ? colors.secondary : colors.textLight} />
                <Text style={[styles.gaugeItemText, { color: i.done ? colors.textSecondary : colors.textLight }]}>{i.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.gaugeHint, { color: colors.textLight }]}>완성도가 높을수록 공고 합격률이 올라가요. 사진·소개는 프로필에서 수정해요.</Text>
        </View>

        {/* 기본 정보 */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>기본 정보</Text>
          <View style={styles.basicRow}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>출생연도</Text>
              <TextInput style={inputStyle} value={birthYear} onChangeText={setBirthYear} placeholder="1990" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={4} />
            </View>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>구력(년)</Text>
              <TextInput style={inputStyle} value={playingYears} onChangeText={setPlayingYears} placeholder="15" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>급수</Text>
            <View style={styles.skillRow}>
              {SKILL_LEVELS.map((lv) => {
                const meta = getSkillMeta(lv);
                const on = skillLevel === lv;
                return (
                  <Pressable
                    key={lv}
                    onPress={() => setSkillLevel(on ? null : lv)}
                    style={[styles.skillChip, { backgroundColor: on ? meta.color : colors.background, borderColor: on ? meta.color : colors.border }]}
                  >
                    <Text style={[styles.skillChipText, { color: on ? '#fff' : colors.textSecondary }]}>{lv}</Text>
                  </Pressable>
                );
              })}
            </View>
            {skillLevel && (
              <Text style={[styles.skillHint, { color: colors.textLight }]}>{getSkillMeta(skillLevel).description}</Text>
            )}
          </View>
        </View>

        {/* 섹션별 경력 */}
        {SECTIONS.map((kind) => {
          const ui = SECTION_UI[kind];
          const sectionEntries = entries.filter((e) => e.kind === kind);
          return (
            <View key={kind} style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
              <View style={styles.sectionHead}>
                <Ionicons name={ui.icon as never} size={16} color={colors.textSecondary} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>{CAREER_KIND_LABEL[kind]}</Text>
                <Text style={[styles.sectionHint, { color: colors.textLight }]} numberOfLines={1}>{ui.hint}</Text>
                <Pressable onPress={() => addEntry(kind)} hitSlop={8} style={[styles.addBtn, { backgroundColor: colors.primary + '14' }]}>
                  <Ionicons name="add" size={14} color={colors.primary} />
                  <Text style={[styles.addBtnText, { color: colors.primary }]}>추가</Text>
                </Pressable>
              </View>
              {sectionEntries.length === 0 ? (
                <Pressable onPress={() => addEntry(kind)} style={[styles.emptyEntry, { borderColor: colors.border }]}>
                  <Text style={[styles.emptyEntryText, { color: colors.textLight }]}>+ {CAREER_KIND_LABEL[kind]} 추가하기</Text>
                </Pressable>
              ) : (
                sectionEntries.map(renderEntry)
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, width: '100%', maxWidth: 560, alignSelf: 'center' }, (pressed || saving) && { opacity: 0.85 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>이력서 저장</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  previewLink: { fontSize: 14, fontWeight: '800' },
  card: { borderRadius: 18, padding: spacing.lg },
  gaugeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gaugeTitle: { fontSize: 15.5, fontWeight: '800' },
  gaugePct: { fontSize: 19, fontWeight: '900' },
  gaugeTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: spacing.sm },
  gaugeFill: { height: 8, borderRadius: 4 },
  gaugeItems: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  gaugeItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gaugeItemText: { fontSize: 11.5, fontWeight: '700' },
  gaugeHint: { fontSize: 11, fontWeight: '600', lineHeight: 15, marginTop: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  sectionHint: { fontSize: 11, fontWeight: '600', flex: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  addBtnText: { fontSize: 12, fontWeight: '800' },
  emptyEntry: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  emptyEntryText: { fontSize: 13, fontWeight: '700' },
  basicRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  field: { gap: 6 },
  flex1: { flex: 1 },
  centerText: { textAlign: 'center' },
  label: { fontSize: 12.5, fontWeight: '700' },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  skillChipText: { fontSize: 15, fontWeight: '900' },
  skillHint: { fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  entryCard: { borderWidth: 1, borderRadius: 14, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  entryHead: { flexDirection: 'row', alignItems: 'center', marginBottom: -6 },
  input: {
    ...typography.body2,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'web' ? 10 : 9,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nowChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  chipRowLabel: { fontSize: 12, fontWeight: '700', marginRight: 3, minWidth: 30 },
  miniChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 13, borderWidth: 1 },
  miniChipText: { fontSize: 12, fontWeight: '800' },
  presetToggle: { fontSize: 12.5, fontWeight: '800' },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  presetChipText: { fontSize: 11.5, fontWeight: '700' },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  primaryBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', paddingHorizontal: spacing.xl },
  primaryBtnText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});

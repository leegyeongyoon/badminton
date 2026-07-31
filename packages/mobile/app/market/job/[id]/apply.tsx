import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../hooks/useTheme';
import { typography, spacing } from '../../../../constants/theme';
import { getSkillMeta } from '../../../../constants/skill';
import { BackButton } from '../../../../components/ui/BackButton';
import { coachJobApi, type JobPostDetail } from '../../../../services/coachJob';
import { coachApi, type CoachDetail } from '../../../../services/coach';
import { showSuccess } from '../../../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 지원하기(원티드식) — 공고 요약 + 첨부될 내 이력서 확인 + 지원 메시지 → 제출.
// 이력서(프로필)가 없으면 작성부터 유도한다.
// ─────────────────────────────────────────────────────────────

export default function JobApply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [job, setJob] = useState<JobPostDetail | null>(null);
  const [me, setMe] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([coachJobApi.get(id).catch(() => null), coachApi.me().catch(() => null)])
      .then(([j, p]) => {
        setJob(j);
        setMe(p);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const completion = (() => {
    if (!me) return 0;
    const entries = me.careerEntries ?? [];
    const items = [
      !!me.photoUrl, !!me.intro, me.birthYear != null, me.playingYears != null, !!me.skillLevel,
      entries.some((e) => e.kind === 'PLAYER' || e.kind === 'COACH'),
      entries.some((e) => e.kind === 'CERT'),
      entries.some((e) => e.kind === 'AWARD'),
    ];
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  })();

  const submit = async () => {
    if (!id || submitting) return;
    setSubmitting(true);
    try {
      await coachJobApi.apply(id, message.trim() || undefined);
      showSuccess('지원이 완료됐어요! 결과는 지원 현황에서 확인해요');
      router.replace(`/market/job/${id}` as never);
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (!job) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: spacing.md }}><BackButton /></View>
        <View style={styles.center}><Text style={{ ...typography.body1, color: colors.textSecondary }}>공고를 찾을 수 없어요</Text></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>지원하기</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 공고 요약 */}
        <View style={[styles.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <Text style={[styles.jobOwner, { color: colors.primary }]}>{job.clubName ?? '개인 요청'}</Text>
          <Text style={[styles.jobTitle, { color: colors.text }]} numberOfLines={2}>{job.title}</Text>
          <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>
            {job.region} · {job.scheduleLabel} · {job.payLabel}
          </Text>
        </View>

        {/* 첨부 이력서 */}
        <Text style={[styles.sectionLabel, { color: colors.textLight }]}>첨부되는 이력서</Text>
        {me ? (
          <View style={[styles.resumeCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <View style={[styles.resumeIcon, { backgroundColor: colors.primary + '10' }]}>
              <Ionicons name="document-text" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[styles.resumeTitle, { color: colors.text }]} numberOfLines={1}>{me.displayName}의 기본 이력서</Text>
                {!!me.skillLevel && (
                  <View style={[styles.skillBadge, { backgroundColor: getSkillMeta(me.skillLevel).color }]}>
                    <Text style={styles.skillBadgeText}>{me.skillLevel}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.resumeMeta, { color: completion >= 80 ? colors.secondary : colors.warning }]}>
                완성도 {completion}%{completion < 80 ? ' — 채우면 합격률이 올라가요' : ''}
              </Text>
            </View>
            <Pressable onPress={() => router.push('/coach/resume' as never)} hitSlop={6}>
              <Text style={[styles.resumeEdit, { color: colors.primary }]}>수정</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.push('/coach/edit' as never)}
            style={[styles.resumeCard, { backgroundColor: colors.surface, borderColor: colors.warning }, shadows.sm]}
          >
            <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.resumeTitle, { color: colors.text }]}>이력서가 없어요</Text>
              <Text style={[styles.resumeMeta, { color: colors.textLight }]}>코치 프로필과 이력서를 만들어야 지원할 수 있어요 — 탭해서 시작</Text>
            </View>
          </Pressable>
        )}

        {/* 지원 메시지 */}
        <Text style={[styles.sectionLabel, { color: colors.textLight }]}>지원 메시지 (선택)</Text>
        <TextInput
          style={[styles.msgInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
          value={message}
          onChangeText={setMessage}
          placeholder={'공고 조건 중 가능한 부분, 어필하고 싶은 경력을 간단히 적어주세요\n예) 월수 저녁 모두 가능합니다. 초중급 지도 경험이 많습니다.'}
          placeholderTextColor={colors.textLight}
          multiline
          maxLength={500}
        />
      </ScrollView>

      <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable
          onPress={submit}
          disabled={submitting || !me}
          style={({ pressed }) => [styles.submitBtn, { backgroundColor: me ? colors.primary : colors.border }, (pressed || submitting) && { opacity: 0.85 }]}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitText}>{me ? '이력서 첨부하고 지원하기' : '이력서를 먼저 만들어 주세요'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  jobCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  jobOwner: { fontSize: 12, fontWeight: '800' },
  jobTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, marginTop: 4, lineHeight: 23 },
  jobMeta: { fontSize: 12.5, fontWeight: '600', marginTop: 6 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3, marginTop: spacing.xs },
  resumeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 16, borderWidth: 1, padding: spacing.lg },
  resumeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resumeTitle: { fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  resumeMeta: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  resumeEdit: { fontSize: 13, fontWeight: '800' },
  skillBadge: { minWidth: 19, height: 17, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  skillBadgeText: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
  msgInput: {
    ...typography.body2, fontWeight: '600', borderWidth: 1, borderRadius: 14,
    paddingHorizontal: spacing.lg, paddingVertical: Platform.OS === 'web' ? 12 : 11,
    minHeight: 110, textAlignVertical: 'top',
  },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  submitBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', maxWidth: 560, width: '100%', alignSelf: 'center' },
  submitText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});

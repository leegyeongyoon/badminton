import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../hooks/useTheme';
import { typography, spacing } from '../../../../constants/theme';
import { getSkillMeta } from '../../../../constants/skill';
import { BackButton } from '../../../../components/ui/BackButton';
import { coachJobApi, APPLICATION_STATUS_LABEL, type JobPostDetail } from '../../../../services/coachJob';
import { absolutizeUploadUrl } from '../../../../services/upload';

// ─────────────────────────────────────────────────────────────
// 지원자 관리(원티드 기업 대시보드) — 공고 상세와 분리된 전용 화면.
// 상단 단계 탭[전체|지원|면접|합격|불합격] → 지원자 리스트 → 지원자 상세.
// 상태 전이는 지원자 상세에서 처리한다(여기는 파이프라인 현황판).
// ─────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'ALL', label: '전체' },
  { key: 'APPLIED', label: '지원' },
  { key: 'INTERVIEW', label: '면접' },
  { key: 'TRIAL', label: '시강' },
  { key: 'OFFERED', label: '오퍼' },
  { key: 'ACCEPTED', label: '확정' },
  { key: 'REJECTED', label: '불합격' },
] as const;

// 불합격 탭에는 코치가 오퍼를 거절한 건(DECLINED)도 함께 묶는다.
const stageMatch = (stage: string, status: string) =>
  stage === 'REJECTED' ? status === 'REJECTED' || status === 'DECLINED' : status === stage;

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function JobApplicants() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [job, setJob] = useState<JobPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stage, setStage] = useState<(typeof STAGES)[number]['key']>('ALL');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setJob(await coachJobApi.get(id));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const apps = job?.applications ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: apps.length };
    STAGES.slice(1).forEach((s) => { c[s.key] = apps.filter((a) => stageMatch(s.key, a.status)).length; });
    return c;
  }, [apps]);
  const filtered = stage === 'ALL' ? apps : apps.filter((a) => stageMatch(stage, a.status));

  const statusColor = (s: string) =>
    s === 'ACCEPTED' ? colors.secondary
      : s === 'INTERVIEW' || s === 'TRIAL' ? colors.primary
      : s === 'OFFERED' ? colors.primary
      : s === 'REJECTED' || s === 'DECLINED' ? colors.textLight
      : colors.textSecondary;

  if (loading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (!job || !job.canManage) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: spacing.md }}><BackButton /></View>
        <View style={styles.center}><Text style={{ ...typography.body1, color: colors.textSecondary }}>지원자를 볼 권한이 없어요</Text></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>지원자 관리</Text>
          <Text style={[styles.sub, { color: colors.textLight }]} numberOfLines={1}>{job.title}</Text>
        </View>
        <Pressable onPress={() => router.push(`/market/job/${job.id}` as never)} hitSlop={8}>
          <Text style={[styles.jobLink, { color: colors.primary }]}>공고 보기</Text>
        </Pressable>
      </View>

      {/* 단계 탭(원티드 파이프라인) */}
      <View style={[styles.stageBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
          {STAGES.map((s) => {
            const on = stage === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setStage(s.key)}
                style={[styles.stageTab, on && { borderBottomColor: colors.primary }]}
              >
                <Text style={[styles.stageLabel, { color: on ? colors.text : colors.textLight }]}>{s.label}</Text>
                <Text style={[styles.stageCount, { color: on ? colors.primary : colors.textLight }]}>{counts[s.key] ?? 0}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={32} color={colors.textLight} />
            <Text style={[styles.emptyText, { color: colors.textLight }]}>
              {apps.length === 0 ? '아직 지원자가 없어요\n코치들이 이력서로 지원하면 여기에 쌓여요' : '이 단계의 지원자가 없어요'}
            </Text>
          </View>
        ) : (
          filtered.map((a) => {
            const photo = absolutizeUploadUrl(a.photoUrl);
            return (
              <Pressable
                key={a.id}
                onPress={() => router.push(`/market/job/${job.id}/applicant/${a.id}` as never)}
                style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 18 }}>{a.displayName.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{a.displayName}</Text>
                    {!!a.skillLevel && (
                      <View style={[styles.skillBadge, { backgroundColor: colors.surface2 }]}>
                        <Text style={[styles.skillBadgeText, { color: colors.textSecondary }]}>{a.skillLevel}</Text>
                      </View>
                    )}
                    {a.certified && <Ionicons name="checkmark-circle" size={13} color={colors.primary} />}
                  </View>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[
                      a.playingYears != null ? `구력 ${a.playingYears}년` : null,
                      a.birthYear != null ? `${String(a.birthYear).slice(2)}년생` : null,
                      a.careerSummary,
                    ].filter(Boolean).join(' · ') || '이력서 보기'}
                  </Text>
                  <Text style={[styles.applied, { color: colors.textLight }]}>{relTime(a.createdAt)} 지원</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={[styles.stateChip, { backgroundColor: statusColor(a.status) + '16' }]}>
                    <Text style={[styles.stateChipText, { color: statusColor(a.status) }]}>{APPLICATION_STATUS_LABEL[a.status]}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.textLight} />
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1 },
  sub: { ...typography.caption, marginTop: 1 },
  jobLink: { fontSize: 13, fontWeight: '600' },
  stageBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  stageTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  stageLabel: { fontSize: 14, fontWeight: '600' },
  stageCount: { fontSize: 13, fontWeight: '700' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.sm + 2 },
  photo: { width: 52, height: 52, borderRadius: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  skillBadge: { minWidth: 20, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  skillBadgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 3 },
  applied: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  stateChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9 },
  stateChipText: { fontSize: 11, fontWeight: '600' },
});

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';
import { getSkillMeta } from '../../constants/skill';
import type { CoachDetail } from '../../services/coach';

// ─────────────────────────────────────────────────────────────
// 이력서 문서(공용 뷰) — 스탯 스트립 + 레슨 조건 + 섹션별 이력.
// 코치 프로필(coach/[id])과 지원자 상세(지원자 관리 → 이력서 열람)가 공유한다.
// ─────────────────────────────────────────────────────────────

const KIND_ORDER = ['PLAYER', 'COACH', 'EDUCATION', 'CERT', 'AWARD'];
const KIND_LABEL: Record<string, string> = {
  PLAYER: '선수 경력', COACH: '지도 경력', EDUCATION: '학력', CERT: '자격증', AWARD: '입상 기록',
};

export function ResumeDocument({
  coach,
  isMe = false,
  showConditions = true,
}: {
  coach: CoachDetail;
  isMe?: boolean;
  showConditions?: boolean;
}) {
  const { colors, shadows } = useTheme();
  const router = useRouter();

  const careerLines = (coach.career || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const entryGroups = KIND_ORDER
    .map((kind) => ({ kind, items: (coach.careerEntries ?? []).filter((e) => e.kind === kind) }))
    .filter((g) => g.items.length > 0);
  const periodLabel = (e: { startYm: string | null; endYm: string | null }) => {
    if (!e.startYm && !e.endYm) return null;
    const s = e.startYm ? e.startYm.replace('-', '.') : '';
    const en = e.endYm ? e.endYm.replace('-', '.') : '현재';
    return `${s} ~ ${en}`;
  };

  return (
    <>
      {/* 핵심 스탯 스트립 — 채용 판단 1차 기준 */}
      <View style={[styles.statStrip, { backgroundColor: colors.surface }, shadows.sm]}>
        <View style={styles.statCell}>
          <View style={[styles.skillBadge, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.skillBadgeText, { color: colors.textSecondary }]}>{coach.skillLevel ?? '—'}</Text>
          </View>
          <Text style={[styles.statLabel, { color: colors.textLight }]}>
            {coach.skillLevel ? getSkillMeta(coach.skillLevel).description : '급수 미설정'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {coach.playingYears != null ? `${coach.playingYears}년` : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textLight }]}>구력</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {coach.birthYear != null ? `${String(coach.birthYear).slice(2)}년생` : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textLight }]}>출생</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {(coach.careerEntries ?? []).filter((e) => e.kind === 'AWARD').length || '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textLight }]}>입상</Text>
        </View>
      </View>

      {/* 레슨 조건 — 라벨-값 */}
      {showConditions && (
        <View style={[styles.infoCard, { backgroundColor: colors.surface }, shadows.sm]}>
          {!!coach.regions && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>활동 지역</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.regions}</Text>
            </View>
          )}
          {coach.pricePerMonth != null && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>월 레슨비</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.pricePerMonth.toLocaleString()}원</Text>
            </View>
          )}
          {coach.pricePerSession != null && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>회당 레슨비</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.pricePerSession.toLocaleString()}원</Text>
            </View>
          )}
          {!!coach.availableTimes && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>가능 시간</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.availableTimes}</Text>
            </View>
          )}
          {coach.lessonCount > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>진행 레슨</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.lessonCount}개</Text>
            </View>
          )}
        </View>
      )}

      {/* 이력서 — 구조화 엔트리 우선, 없으면 자유 텍스트 폴백 */}
      {entryGroups.length > 0 ? (
        <View style={[styles.infoCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.resumeHead}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>이력서</Text>
            {isMe && (
              <Pressable onPress={() => router.push('/coach/resume' as never)} hitSlop={6}>
                <Text style={[styles.resumeEdit, { color: colors.primary }]}>이력서 관리</Text>
              </Pressable>
            )}
          </View>
          {entryGroups.map((g) => (
            <View key={g.kind} style={styles.entryGroup}>
              <Text style={[styles.entryKind, { color: colors.textLight }]}>{KIND_LABEL[g.kind]}</Text>
              {g.items.map((e) => {
                const single = g.kind === 'CERT' || g.kind === 'AWARD';
                const period = single ? e.startYm?.replace('-', '.') ?? null : periodLabel(e);
                return (
                  <View key={e.id} style={[styles.entryRow, { borderLeftColor: colors.border }]}>
                    <View style={styles.entryTitleRow}>
                      <Text style={[styles.entryTitle, { color: colors.text }]}>{e.title}</Text>
                      {g.kind === 'AWARD' && !!e.result && (
                        <View style={[styles.resultBadge, { backgroundColor: colors.surface2 }]}>
                          <Text style={[styles.resultBadgeText, { color: e.result === '우승' ? colors.primary : colors.textSecondary }]}>{e.result}</Text>
                        </View>
                      )}
                      {g.kind === 'AWARD' && !!e.division && (
                        <View style={[styles.divisionBadge, { borderColor: colors.border }]}>
                          <Text style={[styles.divisionBadgeText, { color: colors.textSecondary }]}>{e.division}</Text>
                        </View>
                      )}
                    </View>
                    {(e.org || period) && (
                      <Text style={[styles.entryMeta, { color: colors.textSecondary }]}>
                        {[e.org, period].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                    {!!e.description && <Text style={[styles.entryDesc, { color: colors.textLight }]}>{e.description}</Text>}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : careerLines.length > 0 ? (
        <View style={[styles.infoCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>경력 · 이력</Text>
          {careerLines.map((line, i) => (
            <View key={i} style={styles.careerRow}>
              <View style={[styles.careerDot, { backgroundColor: colors.textLight }]} />
              <Text style={[styles.careerText, { color: colors.textSecondary }]}>{line}</Text>
            </View>
          ))}
        </View>
      ) : isMe ? (
        <Pressable
          onPress={() => router.push('/coach/resume' as never)}
          style={[styles.infoCard, { backgroundColor: colors.surface, alignItems: 'center' }, shadows.sm]}
        >
          <Text style={[styles.resumeEmptyText, { color: colors.textSecondary }]}>
            아직 이력서가 비어 있어요 — 경력을 채우면 공고 지원에 유리해요
          </Text>
          <Text style={[styles.resumeEdit, { color: colors.primary }]}>이력서 작성하기</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  statStrip: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: spacing.lg, marginBottom: spacing.md },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  statValue: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 11, fontWeight: '700' },
  skillBadge: { minWidth: 26, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  skillBadgeText: { fontSize: 13, fontWeight: '700' },
  infoCard: { borderRadius: 12, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.smd },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  infoLabel: { fontSize: 13, fontWeight: '700', width: 76 },
  infoValue: { fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  resumeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resumeEdit: { fontSize: 13, fontWeight: '600' },
  resumeEmptyText: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 6 },
  entryGroup: { gap: 2, marginTop: spacing.xs },
  entryKind: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, marginBottom: 4 },
  entryRow: { borderLeftWidth: 2, paddingLeft: spacing.md, paddingVertical: 5, marginBottom: 4 },
  entryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  entryTitle: { fontSize: 14, fontWeight: '600' },
  entryMeta: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  entryDesc: { fontSize: 12, fontWeight: '600', marginTop: 3, lineHeight: 17 },
  resultBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  resultBadgeText: { fontSize: 11, fontWeight: '600' },
  divisionBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  divisionBadgeText: { fontSize: 11, fontWeight: '600' },
  careerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  careerDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  careerText: { fontSize: 13, fontWeight: '600', flex: 1, lineHeight: 20 },
});

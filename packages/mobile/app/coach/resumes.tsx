import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, type CoachDetail } from '../../services/coach';
import { careerApi, type CareerEntry } from '../../services/coachJob';

// ─────────────────────────────────────────────────────────────
// 이력서 관리(원티드식 문서 목록) — 이력서를 '문서'로 다룬다.
// 문서 카드: 제목·최종 수정일·완성도·항목 요약 → 탭하면 편집 폼.
// 공고 지원 시 이 문서가 첨부된다.
// ─────────────────────────────────────────────────────────────

export default function CoachResumes() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<CoachDetail | null>(null);
  const [entries, setEntries] = useState<CareerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      Promise.all([coachApi.me().catch(() => null), careerApi.get().catch(() => [])])
        .then(([p, career]) => {
          setProfile(p);
          setEntries(career);
        })
        .finally(() => setLoading(false));
    }, []),
  );

  const completion = (() => {
    if (!profile) return 0;
    const items = [
      !!profile.photoUrl, !!profile.intro, profile.birthYear != null, profile.playingYears != null,
      !!profile.skillLevel,
      entries.some((e) => e.kind === 'PLAYER' || e.kind === 'COACH'),
      entries.some((e) => e.kind === 'CERT'),
      entries.some((e) => e.kind === 'AWARD'),
    ];
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  })();

  const summary = (() => {
    const count = (k: string) => entries.filter((e) => e.kind === k).length;
    const parts = [
      count('PLAYER') + count('COACH') > 0 ? `경력 ${count('PLAYER') + count('COACH')}` : null,
      count('CERT') > 0 ? `자격증 ${count('CERT')}` : null,
      count('AWARD') > 0 ? `입상 ${count('AWARD')}` : null,
      count('EDUCATION') > 0 ? `학력 ${count('EDUCATION')}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '아직 항목이 없어요';
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>이력서 관리</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !profile ? (
        <View style={[styles.center, { gap: spacing.md, padding: spacing.xl }]}>
          <Ionicons name="document-text-outline" size={40} color={colors.textLight} />
          <Text style={{ ...typography.subtitle1, color: colors.text }}>먼저 코치 프로필을 만들어 주세요</Text>
          <Text style={{ ...typography.caption, color: colors.textLight, textAlign: 'center' }}>
            프로필(이름·사진)을 만들면 이력서를 작성할 수 있어요
          </Text>
          <Pressable onPress={() => router.replace('/coach/edit' as never)} style={[styles.newBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.newBtnText}>코치 프로필 만들기</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}>
          <Text style={[styles.pageHint, { color: colors.textSecondary }]}>
            공고에 지원하면 아래 이력서가 첨부돼요. 완성도가 높을수록 합격률이 올라가요.
          </Text>

          {/* 이력서 문서 카드 */}
          <Pressable
            onPress={() => router.push('/coach/resume' as never)}
            style={({ pressed }) => [styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
          >
            <View style={[styles.docIcon, { backgroundColor: colors.primary + '10' }]}>
              <Ionicons name="document-text" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.docTitle, { color: colors.text }]}>{profile.displayName}의 기본 이력서</Text>
              <Text style={[styles.docSummary, { color: colors.textSecondary }]} numberOfLines={1}>{summary}</Text>
              <View style={styles.docGaugeRow}>
                <View style={[styles.docGaugeTrack, { backgroundColor: colors.background }]}>
                  <View style={[styles.docGaugeFill, { width: `${completion}%`, backgroundColor: completion >= 80 ? colors.secondary : colors.primary }]} />
                </View>
                <Text style={[styles.docPct, { color: completion >= 80 ? colors.secondary : colors.primary }]}>{completion}%</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textLight} />
          </Pressable>

          {/* 미리보기(공개 프로필로) */}
          <Pressable
            onPress={() => router.push(`/coach/${profile.id}` as never)}
            style={({ pressed }) => [styles.previewRow, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="eye-outline" size={15} color={colors.textSecondary} />
            <Text style={[styles.previewText, { color: colors.textSecondary }]}>공고 측에 보이는 모습 미리보기</Text>
          </Pressable>

          <Text style={[styles.footHint, { color: colors.textLight }]}>
            사진·한 줄 소개·레슨 조건은 프로필에서, 경력·자격증·입상은 이력서에서 관리해요
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageHint: { fontSize: 13, fontWeight: '600', lineHeight: 19 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  docIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  docTitle: { fontSize: 15.5, fontWeight: '800' },
  docSummary: { fontSize: 12.5, fontWeight: '600', marginTop: 3 },
  docGaugeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8 },
  docGaugeTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  docGaugeFill: { height: 6, borderRadius: 3 },
  docPct: { fontSize: 12.5, fontWeight: '900', minWidth: 34, textAlign: 'right' },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  previewText: { fontSize: 13, fontWeight: '700' },
  footHint: { fontSize: 11.5, fontWeight: '600', textAlign: 'center', lineHeight: 16 },
  newBtn: { paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});

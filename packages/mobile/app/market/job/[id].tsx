import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Image } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { coachJobApi, APPLICATION_STATUS_LABEL, type JobPostDetail, type OfferTerms } from '../../../services/coachJob';
import { showSuccess } from '../../../utils/feedback';
import { absolutizeUploadUrl } from '../../../services/upload';

// ─────────────────────────────────────────────────────────────
// 공고 상세(원티드식 슬림) — 공고 내용에 집중.
//  코치: [지원하기] → 지원 화면(이력서 첨부) / 지원 후 상태 배너
//  작성자: [지원자 관리 N] 대시보드 진입 + 공고 마감·수정·삭제
// ─────────────────────────────────────────────────────────────

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const confirmAsk = (title: string, message: string, onOk: () => void) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n${message}`)) onOk();
  } else {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      { text: '확인', style: 'destructive', onPress: onOk },
    ]);
  }
};

export default function JobPostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [job, setJob] = useState<JobPostDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setJob(await coachJobApi.get(id));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const withdraw = () => {
    if (!id || !job?.myApplication) return;
    confirmAsk('지원 철회', '이 공고 지원을 철회할까요? 나중에 다시 지원할 수 있어요.', async () => {
      try {
        await coachJobApi.setApplicationStatus(id, job.myApplication!.id, 'WITHDRAWN');
        showSuccess('지원을 철회했어요');
        await load();
      } catch { /* noop */ }
    });
  };

  const toggleClosed = () => {
    if (!id || !job) return;
    const closing = job.status === 'OPEN';
    confirmAsk(closing ? '공고 마감' : '공고 재개', closing ? '공고를 마감하면 새 지원을 받지 않아요.' : '공고를 다시 열까요?', async () => {
      try {
        await coachJobApi.update(id, { status: closing ? 'CLOSED' : 'OPEN' });
        showSuccess(closing ? '공고를 마감했어요' : '공고를 다시 열었어요');
        await load();
      } catch { /* noop */ }
    });
  };

  const removePost = () => {
    if (!id) return;
    confirmAsk('공고 삭제', '지원 내역도 함께 삭제돼요.', async () => {
      try {
        await coachJobApi.remove(id);
        showSuccess('삭제했어요');
        router.back();
      } catch { /* noop */ }
    });
  };

  const stageCounts = useMemo(() => {
    const apps = job?.applications ?? [];
    return {
      total: apps.length,
      applied: apps.filter((a) => a.status === 'APPLIED').length,
      interview: apps.filter((a) => a.status === 'INTERVIEW').length,
      accepted: apps.filter((a) => a.status === 'ACCEPTED').length,
    };
  }, [job]);

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

  const my = job.myApplication;
  const myStatusColor =
    my?.status === 'ACCEPTED' ? colors.secondary
      : my?.status === 'INTERVIEW' ? colors.primary
      : my?.status === 'OFFERED' ? colors.info
      : my?.status === 'REJECTED' || my?.status === 'DECLINED' ? colors.textLight
      : colors.warning;

  const offerSummary = (t: OfferTerms | null) => {
    if (!t) return '';
    return [
      t.payMonthly ? `월 ${t.payMonthly.toLocaleString()}원` : null,
      t.paySession ? `회당 ${t.paySession.toLocaleString()}원` : null,
      t.startNote,
    ].filter(Boolean).join(' · ');
  };

  const replyOffer = (accept: boolean) => {
    if (!id || !my) return;
    const act = async () => {
      try {
        await coachJobApi.setApplicationStatus(id, my.id, accept ? 'ACCEPTED' : 'DECLINED');
        showSuccess(accept ? '오퍼를 수락했어요 — 채용이 확정됐어요 🎉' : '오퍼를 정중히 거절했어요');
        await load();
      } catch { /* noop */ }
    };
    confirmAsk(
      accept ? '오퍼 수락' : '오퍼 거절',
      accept ? '이 조건으로 채용을 확정할까요?' : '오퍼를 거절할까요? 되돌릴 수 없어요.',
      act,
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          {job.clubName ?? '개인 요청'} · 코치 구인
        </Text>
        {job.canManage && (
          <Pressable onPress={() => router.push(`/market/job/new?id=${job.id}` as never)} hitSlop={8}>
            <Text style={[styles.editLink, { color: colors.primary }]}>수정</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 130, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}>
        {job.status === 'CLOSED' && (
          <View style={[styles.closedBanner, { backgroundColor: colors.textLight + '22' }]}>
            <Text style={[styles.closedText, { color: colors.textSecondary }]}>마감된 공고예요</Text>
          </View>
        )}

        <Text style={[styles.jobTitle, { color: colors.text }]}>{job.title}</Text>
        <Text style={[styles.author, { color: colors.textLight }]}>
          {job.clubName ? `${job.clubName} · ${job.authorName}` : `${job.authorName} (개인)`} · 지원 {job.applicants}명
        </Text>

        {/* 모집공고 사진(체육관·코트) */}
        {job.photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: spacing.sm }}>
            {job.photos.map((ph) => (
              <Image key={ph} source={{ uri: absolutizeUploadUrl(ph)! }} style={styles.galleryPhoto} />
            ))}
          </ScrollView>
        )}

        {/* ── 작성자: 지원자 관리 대시보드 진입(원티드) ── */}
        {job.canManage && (
          <Pressable
            onPress={() => router.push(`/market/job/${job.id}/applicants` as never)}
            style={({ pressed }) => [styles.applicantsCard, { backgroundColor: colors.primary }, shadows.md, pressed && { opacity: 0.9 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.applicantsTitle}>지원자 관리</Text>
              <Text style={styles.applicantsMeta}>
                지원 {stageCounts.applied} · 면접 {stageCounts.interview} · 합격 {stageCounts.accepted}
              </Text>
            </View>
            {stageCounts.applied > 0 && (
              <View style={styles.newBadge}>
                <Text style={[styles.newBadgeText, { color: colors.primary }]}>검토 대기 {stageCounts.applied}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}

        {/* 조건 — 라벨-값 */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textLight }]}>지역</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{job.region}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textLight }]}>요일·시간</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {job.days && job.days.length > 0 ? job.days.map((d) => DAY_KO[d]).join('·') : '요일 협의'}
              {job.start && job.end ? ` ${job.start}~${job.end}` : ' · 시간 협의'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textLight }]}>급여</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{job.payLabel}</Text>
          </View>
          {!!job.requirements && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>우대·요구</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{job.requirements}</Text>
            </View>
          )}
        </View>

        {!!job.description && (
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>상세 설명</Text>
            <Text style={[styles.desc, { color: colors.textSecondary }]}>{job.description}</Text>
          </View>
        )}

        {/* ── 코치: 내 지원 상태 배너 ── */}
        {!job.canManage && my && (
          <View style={[styles.myStatusCard, { backgroundColor: myStatusColor + '12', borderColor: myStatusColor + '55' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.myStatusTitle, { color: myStatusColor }]}>
                {APPLICATION_STATUS_LABEL[my.status] ?? my.status}
              </Text>
              <Text style={[styles.myStatusHint, { color: colors.textSecondary }]}>
                {my.status === 'APPLIED' && '공고 측이 이력서를 검토 중이에요'}
                {my.status === 'INTERVIEW' && '면접 제안이 왔어요 — 채팅으로 대화해 보세요'}
                {my.status === 'OFFERED' && '채용 조건이 도착했어요 — 확인하고 회신해 주세요'}
                {my.status === 'ACCEPTED' && '채용이 확정됐어요! 채팅으로 세부 사항을 정해보세요'}
                {my.status === 'DECLINED' && '오퍼를 거절했어요'}
                {my.status === 'REJECTED' && '아쉽지만 다음 기회를 노려봐요'}
              </Text>
              {my.status === 'INTERVIEW' && (my.interviewWhen || my.interviewPlace || my.interviewNote) && (
                <Text style={[styles.myStatusHint, { color: colors.text, fontWeight: '800', marginTop: 4 }]}>
                  📅 {[my.interviewWhen, my.interviewPlace].filter(Boolean).join(' · ') || '일정 협의 중'}
                  {my.interviewNote ? `\n${my.interviewNote}` : ''}
                </Text>
              )}
            </View>
            {(my.status === 'INTERVIEW' || my.status === 'ACCEPTED' || my.status === 'OFFERED') && (
              <Pressable onPress={() => router.push('/coach/inbox' as never)} style={[styles.smallBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.smallBtnText}>채팅</Text>
              </Pressable>
            )}
            {(my.status === 'APPLIED' || my.status === 'INTERVIEW') && (
              <Pressable onPress={withdraw} hitSlop={6}>
                <Text style={[styles.withdrawText, { color: colors.textLight }]}>철회</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── 코치: 오퍼레터 회신 카드 ── */}
        {!job.canManage && my?.status === 'OFFERED' && my.offerTerms && (
          <View style={[styles.offerCard, { backgroundColor: colors.surface, borderColor: colors.info + '55' }, shadows.sm]}>
            <Text style={[styles.offerTitle, { color: colors.info }]}>오퍼레터 📄</Text>
            <Text style={[styles.offerTerms, { color: colors.text }]}>{offerSummary(my.offerTerms)}</Text>
            {!!my.offerTerms.message && (
              <Text style={[styles.offerMsg, { color: colors.textSecondary }]}>{my.offerTerms.message}</Text>
            )}
            <View style={styles.offerActions}>
              <Pressable onPress={() => replyOffer(false)} style={[styles.offerDecline, { borderColor: colors.border }]}>
                <Text style={[styles.offerDeclineText, { color: colors.textSecondary }]}>정중히 거절</Text>
              </Pressable>
              <Pressable onPress={() => replyOffer(true)} style={({ pressed }) => [styles.offerAccept, { backgroundColor: colors.secondary }, pressed && { opacity: 0.85 }]}>
                <Text style={styles.offerAcceptText}>오퍼 수락 — 채용 확정</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── 작성자: 공고 관리 ── */}
        {job.canManage && (
          <View style={styles.manageRow}>
            <Pressable onPress={toggleClosed} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: colors.textSecondary }]}>{job.status === 'OPEN' ? '공고 마감' : '공고 재개'}</Text>
            </Pressable>
            <Pressable onPress={removePost} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: colors.danger }]}>삭제</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* 코치 하단 CTA — 지원 화면으로(원티드식 이력서 첨부 flow) */}
      {!job.canManage && !my && job.status === 'OPEN' && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            onPress={() => router.push(`/market/job/${job.id}/apply` as never)}
            style={({ pressed }) => [styles.applyBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="document-text-outline" size={17} color="#fff" />
            <Text style={styles.applyBtnText}>지원하기</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  topTitle: { ...typography.subtitle1, flex: 1 },
  editLink: { fontSize: 14, fontWeight: '800' },
  closedBanner: { borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginBottom: spacing.md },
  closedText: { fontSize: 13, fontWeight: '800' },
  jobTitle: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, lineHeight: 28 },
  author: { fontSize: 12.5, fontWeight: '600', marginTop: 6, marginBottom: spacing.lg },
  galleryPhoto: { width: 200, height: 140, borderRadius: 14 },
  applicantsCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md },
  applicantsTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  applicantsMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '700', marginTop: 3 },
  newBadge: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 11 },
  newBadgeText: { fontSize: 12, fontWeight: '900' },
  infoCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.smd },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  infoLabel: { fontSize: 13, fontWeight: '700', width: 76 },
  infoValue: { fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  desc: { fontSize: 13.5, fontWeight: '600', lineHeight: 21 },
  myStatusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 16, padding: spacing.lg, marginTop: spacing.xs },
  offerCard: { borderWidth: 1, borderRadius: 16, padding: spacing.lg, marginTop: spacing.md },
  offerTitle: { fontSize: 13, fontWeight: '900' },
  offerTerms: { fontSize: 16, fontWeight: '800', marginTop: 6 },
  offerMsg: { fontSize: 13, fontWeight: '600', marginTop: 6, lineHeight: 19 },
  offerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  offerDecline: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  offerDeclineText: { fontSize: 13.5, fontWeight: '800' },
  offerAccept: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  offerAcceptText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  myStatusTitle: { fontSize: 15, fontWeight: '900' },
  myStatusHint: { fontSize: 12.5, fontWeight: '600', marginTop: 3, lineHeight: 18 },
  smallBtn: { paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: 10 },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  withdrawText: { fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  manageRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  manageBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  manageBtnText: { fontSize: 13.5, fontWeight: '800' },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 15, borderRadius: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  applyBtnText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});

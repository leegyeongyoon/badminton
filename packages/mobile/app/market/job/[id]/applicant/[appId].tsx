import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, Platform, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../../hooks/useTheme';
import { typography, spacing } from '../../../../../constants/theme';
import { getSkillMeta } from '../../../../../constants/skill';
import { BackButton } from '../../../../../components/ui/BackButton';
import { ResumeDocument } from '../../../../../components/market/ResumeDocument';
import { coachJobApi, APPLICATION_STATUS_LABEL, type JobApplicantRow, type OfferTerms } from '../../../../../services/coachJob';
import { coachApi, coachChatApi, type CoachDetail } from '../../../../../services/coach';
import { absolutizeUploadUrl } from '../../../../../services/upload';
import { showSuccess } from '../../../../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 지원자 상세(원티드식) — 이력서 전문 + 지원 메시지 + 하단 단계 액션 바.
// 지원자 관리 리스트에서 진입. 면접 제안 시 채팅이 열린다.
// ─────────────────────────────────────────────────────────────

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

export default function ApplicantDetail() {
  const { id: postId, appId } = useLocalSearchParams<{ id: string; appId: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [app, setApp] = useState<JobApplicantRow | null>(null);
  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 오퍼레터 작성 폼
  const [showOffer, setShowOffer] = useState(false);
  // 면접 안내 폼(제안 시·수정 시 공용)
  const [showInterview, setShowInterview] = useState(false);
  const [ivWhen, setIvWhen] = useState('');
  const [ivPlace, setIvPlace] = useState('');
  const [ivNote, setIvNote] = useState('');
  // 운영 메모(공고측 전용)
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [offerPayMonthly, setOfferPayMonthly] = useState('');
  const [offerPaySession, setOfferPaySession] = useState('');
  const [offerStartNote, setOfferStartNote] = useState('');
  const [offerMessage, setOfferMessage] = useState('');

  const load = useCallback(async () => {
    if (!postId || !appId) return;
    try {
      const job = await coachJobApi.get(postId);
      const found = (job.applications ?? []).find((a) => a.id === appId) ?? null;
      setApp(found);
      if (found) {
        setNote(found.managerNote ?? '');
        setCoach(await coachApi.get(found.coachProfileId));
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [postId, appId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (status: string, offer?: OfferTerms, interview?: { when?: string | null; place?: string | null; note?: string | null }) => {
    if (!postId || !appId || !app || busy) return;
    const act = async () => {
      setBusy(true);
      try {
        const { threadId } = await coachJobApi.setApplicationStatus(postId, appId, status, offer, interview);
        if (status === 'INTERVIEW') {
          showSuccess(`${app.displayName} 코치에게 면접을 제안했어요`);
          setShowInterview(false);
          await load();
          if (threadId) router.push(`/coach-chat/${threadId}` as never);
        } else if (status === 'OFFERED') {
          showSuccess('오퍼레터를 보냈어요 — 코치의 회신을 기다려요');
          setShowOffer(false);
          await load();
        } else {
          showSuccess('불합격 처리했어요');
          await load();
        }
      } catch { /* noop */ } finally {
        setBusy(false);
      }
    };
    if (status === 'REJECTED') confirmAsk(app.status === 'OFFERED' ? '오퍼 철회' : '불합격 처리', `${app.displayName} 코치를 ${app.status === 'OFFERED' ? '오퍼 철회(불합격)' : '불합격'} 처리할까요?`, act);
    else act();
  };

  const openInterviewForm = () => {
    setIvWhen(app?.interviewWhen ?? '');
    setIvPlace(app?.interviewPlace ?? '');
    setIvNote(app?.interviewNote ?? '');
    setShowInterview(true);
  };

  const submitInterview = async () => {
    const info = { when: ivWhen.trim() || null, place: ivPlace.trim() || null, note: ivNote.trim() || null };
    if (app?.status === 'APPLIED') {
      await setStatus('INTERVIEW', undefined, info);
      return;
    }
    // 이미 면접 단계 — 안내만 갱신
    if (!postId || !appId || busy) return;
    setBusy(true);
    try {
      await coachJobApi.setInterview(postId, appId, info);
      showSuccess('면접 안내를 보냈어요');
      setShowInterview(false);
      await load();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!postId || !appId || noteSaving) return;
    setNoteSaving(true);
    try {
      await coachJobApi.setNote(postId, appId, note.trim() || null);
      showSuccess('메모를 저장했어요');
    } catch { /* noop */ } finally {
      setNoteSaving(false);
    }
  };

  const sendOffer = () => {
    if (!offerPayMonthly.trim() && !offerPaySession.trim()) {
      confirmAsk('급여 미입력', '오퍼레터에는 급여(월 또는 회당)가 필요해요. 다시 확인해 주세요.', () => {});
      return;
    }
    setStatus('OFFERED', {
      payMonthly: offerPayMonthly.trim() ? Number(offerPayMonthly.replace(/[^0-9]/g, '')) : null,
      paySession: offerPaySession.trim() ? Number(offerPaySession.replace(/[^0-9]/g, '')) : null,
      startNote: offerStartNote.trim() || null,
      message: offerMessage.trim() || null,
    });
  };

  const offerSummary = (t: OfferTerms | null) => {
    if (!t) return '';
    return [
      t.payMonthly ? `월 ${t.payMonthly.toLocaleString()}원` : null,
      t.paySession ? `회당 ${t.paySession.toLocaleString()}원` : null,
      t.startNote,
    ].filter(Boolean).join(' · ');
  };

  const openChat = async () => {
    if (!app) return;
    try {
      const thread = await coachChatApi.start(app.coachProfileId);
      router.push(`/coach-chat/${thread.threadId}` as never);
    } catch { /* noop */ }
  };

  if (loading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (!app || !coach) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: spacing.md }}><BackButton /></View>
        <View style={styles.center}><Text style={{ ...typography.body1, color: colors.textSecondary }}>지원자를 찾을 수 없어요</Text></View>
      </View>
    );
  }

  const photo = absolutizeUploadUrl(app.photoUrl);
  const statusColor =
    app.status === 'ACCEPTED' ? colors.secondary
      : app.status === 'INTERVIEW' ? colors.primary
      : app.status === 'OFFERED' ? colors.info
      : app.status === 'REJECTED' || app.status === 'DECLINED' ? colors.textLight
      : colors.warning;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>지원자 이력서</Text>
        <View style={[styles.stateChip, { backgroundColor: statusColor + '16' }]}>
          <Text style={[styles.stateChipText, { color: statusColor }]}>{APPLICATION_STATUS_LABEL[app.status]}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 130, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}>
        {/* 지원자 헤더 */}
        <View style={styles.header}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, { backgroundColor: colors.primary + '10', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.primary, fontSize: 28, fontWeight: '900' }}>{app.displayName.slice(0, 1)}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{app.displayName}</Text>
              {!!app.skillLevel && (
                <View style={[styles.skillBadge, { backgroundColor: getSkillMeta(app.skillLevel).color }]}>
                  <Text style={styles.skillBadgeText}>{app.skillLevel}</Text>
                </View>
              )}
              {app.certified && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
            </View>
            {!!coach.intro && <Text style={[styles.intro, { color: colors.textSecondary }]} numberOfLines={2}>{coach.intro}</Text>}
          </View>
        </View>

        {/* 지원 메시지 */}
        {!!app.message && (
          <View style={[styles.msgCard, { backgroundColor: colors.primary + '0A', borderColor: colors.primary + '30' }]}>
            <Text style={[styles.msgLabel, { color: colors.primary }]}>지원 메시지</Text>
            <Text style={[styles.msgText, { color: colors.text }]}>{app.message}</Text>
          </View>
        )}

        {/* 면접 안내(공고측이 잡은 일시·장소) */}
        {(app.interviewWhen || app.interviewPlace || app.interviewNote) && (
          <View style={[styles.msgCard, { backgroundColor: colors.warning + '0C', borderColor: colors.warning + '40' }]}>
            <Text style={[styles.msgLabel, { color: colors.warning }]}>면접 안내</Text>
            <Text style={[styles.msgText, { color: colors.text }]}>
              {[app.interviewWhen, app.interviewPlace].filter(Boolean).join(' · ') || '일정 협의 중'}
            </Text>
            {!!app.interviewNote && <Text style={[styles.noteHint, { color: colors.textSecondary }]}>{app.interviewNote}</Text>}
            {app.status === 'INTERVIEW' && (
              <Pressable onPress={openInterviewForm} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                <Text style={[styles.editLink, { color: colors.primary }]}>안내 수정</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* 운영 메모 — 공고측 전용(코치 비노출) */}
        <View style={[styles.msgCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.msgLabel, { color: colors.textSecondary }]}>운영 메모 (지원자에게 보이지 않아요)</Text>
          <TextInput
            style={[styles.noteInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
            value={note} onChangeText={setNote}
            placeholder="면접 평가·특이사항 등을 기록해 두세요"
            placeholderTextColor={colors.textLight}
            multiline maxLength={1000}
          />
          <Pressable onPress={saveNote} disabled={noteSaving} style={({ pressed }) => [styles.noteSaveBtn, { backgroundColor: colors.primary + '12' }, (pressed || noteSaving) && { opacity: 0.7 }]}>
            <Text style={[styles.noteSaveText, { color: colors.primary }]}>{noteSaving ? '저장 중…' : '메모 저장'}</Text>
          </Pressable>
        </View>

        {/* 오퍼레터(발송 후) — 제시한 조건 */}
        {app.offerTerms && (app.status === 'OFFERED' || app.status === 'ACCEPTED' || app.status === 'DECLINED') && (
          <View style={[styles.offerCard, { backgroundColor: colors.info + '0A', borderColor: colors.info + '40' }]}>
            <Text style={[styles.offerLabel, { color: colors.info }]}>보낸 오퍼레터</Text>
            <Text style={[styles.offerText, { color: colors.text }]}>{offerSummary(app.offerTerms)}</Text>
            {!!app.offerTerms.message && <Text style={[styles.offerMsg, { color: colors.textSecondary }]}>{app.offerTerms.message}</Text>}
          </View>
        )}

        <ResumeDocument coach={coach} />
      </ScrollView>

      {/* 단계 액션 바(원티드) — 상태별 액션 + 오퍼레터 작성 */}
      <View style={[styles.actionBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {showInterview ? (
          <View style={[styles.offerForm, { maxWidth: 560, width: '100%', alignSelf: 'center' }]}>
            <Text style={[styles.offerFormTitle, { color: colors.text }]}>면접 안내 (모두 선택 — 비우면 채팅으로 조율)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}
                value={ivWhen} onChangeText={setIvWhen}
                placeholder="일시 (예: 8/10 토 19:00)" placeholderTextColor={colors.textLight} maxLength={80}
              />
              <TextInput
                style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}
                value={ivPlace} onChangeText={setIvPlace}
                placeholder="장소 (예: OO체육관)" placeholderTextColor={colors.textLight} maxLength={120}
              />
            </View>
            <TextInput
              style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              value={ivNote} onChangeText={setIvNote}
              placeholder="메모 (예: 라켓 지참, 시범 레슨 30분)" placeholderTextColor={colors.textLight} maxLength={300}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable onPress={() => setShowInterview(false)} style={[styles.ghostBtn, { borderColor: colors.border, flex: 1 }]}>
                <Text style={[styles.ghostText, { color: colors.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable onPress={submitInterview} disabled={busy} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, flex: 2 }, (pressed || busy) && { opacity: 0.85 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="chatbubble-ellipses-outline" size={15} color="#fff" />
                    <Text style={styles.primaryText}>{app.status === 'APPLIED' ? '면접 제안' : '안내 보내기'}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : showOffer ? (
          <View style={[styles.offerForm, { maxWidth: 560, width: '100%', alignSelf: 'center' }]}>
            <Text style={[styles.offerFormTitle, { color: colors.text }]}>오퍼레터 작성</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}
                value={offerPayMonthly} onChangeText={setOfferPayMonthly}
                placeholder="월 급여(원)" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9}
              />
              <TextInput
                style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}
                value={offerPaySession} onChangeText={setOfferPaySession}
                placeholder="회당 급여(원)" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9}
              />
            </View>
            <TextInput
              style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              value={offerStartNote} onChangeText={setOfferStartNote}
              placeholder="시작 시기·요일 등 (예: 9월 첫째 주부터, 월·수 저녁)" placeholderTextColor={colors.textLight} maxLength={100}
            />
            <TextInput
              style={[styles.offerInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, minHeight: 56, textAlignVertical: 'top' }]}
              value={offerMessage} onChangeText={setOfferMessage}
              placeholder="메시지 (선택 — 환영 인사, 기타 조건)" placeholderTextColor={colors.textLight} multiline maxLength={500}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable onPress={() => setShowOffer(false)} style={[styles.ghostBtn, { borderColor: colors.border, flex: 1 }]}>
                <Text style={[styles.ghostText, { color: colors.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable onPress={sendOffer} disabled={busy} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.info, flex: 2 }, (pressed || busy) && { opacity: 0.85 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="document-text-outline" size={15} color="#fff" />
                    <Text style={styles.primaryText}>오퍼레터 전송</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.actionRow}>
            {app.status === 'APPLIED' && (
              <>
                <Pressable onPress={() => setStatus('REJECTED')} disabled={busy} style={[styles.ghostBtn, { borderColor: colors.border }]}>
                  <Text style={[styles.ghostText, { color: colors.textSecondary }]}>불합격</Text>
                </Pressable>
                <Pressable onPress={openInterviewForm} disabled={busy} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, flex: 2 }, (pressed || busy) && { opacity: 0.85 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                      <Text style={styles.primaryText}>면접 제안 (채팅)</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
            {app.status === 'INTERVIEW' && (
              <>
                <Pressable onPress={openChat} disabled={busy} style={[styles.ghostBtn, { borderColor: colors.border }]}>
                  <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
                  <Text style={[styles.ghostText, { color: colors.textSecondary }]}>채팅</Text>
                </Pressable>
                <Pressable onPress={() => setStatus('REJECTED')} disabled={busy} style={[styles.ghostBtn, { borderColor: colors.border }]}>
                  <Text style={[styles.ghostText, { color: colors.textSecondary }]}>불합격</Text>
                </Pressable>
                <Pressable onPress={() => setShowOffer(true)} disabled={busy} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.info, flex: 1.8 }, (pressed || busy) && { opacity: 0.85 }]}>
                  <Ionicons name="document-text-outline" size={15} color="#fff" />
                  <Text style={styles.primaryText}>오퍼레터 보내기</Text>
                </Pressable>
              </>
            )}
            {app.status === 'OFFERED' && (
              <>
                <Pressable onPress={openChat} style={[styles.ghostBtn, { borderColor: colors.border, flex: 1 }]}>
                  <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
                  <Text style={[styles.ghostText, { color: colors.textSecondary }]}>채팅</Text>
                </Pressable>
                <Pressable onPress={() => setStatus('REJECTED')} disabled={busy} style={[styles.ghostBtn, { borderColor: colors.border, flex: 1 }]}>
                  <Text style={[styles.ghostText, { color: colors.textSecondary }]}>오퍼 철회</Text>
                </Pressable>
                <View style={[styles.waitBadge, { backgroundColor: colors.info + '14', flex: 1.4 }]}>
                  <Text style={[styles.waitText, { color: colors.info }]}>코치 회신 대기 중</Text>
                </View>
              </>
            )}
            {(app.status === 'ACCEPTED' || app.status === 'REJECTED' || app.status === 'DECLINED') && (
              <Pressable onPress={openChat} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, flex: 1 }, pressed && { opacity: 0.85 }]}>
                <Ionicons name="chatbubble-outline" size={16} color="#fff" />
                <Text style={styles.primaryText}>{app.status === 'ACCEPTED' ? '채용 확정 — 채팅으로 세부 협의' : '채팅 보기'}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noteHint: { fontSize: 12.5, fontWeight: '600', marginTop: 4, lineHeight: 18 },
  editLink: { fontSize: 12.5, fontWeight: '800', textDecorationLine: 'underline' },
  noteInput: { fontSize: 13.5, fontWeight: '600', borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 64, textAlignVertical: 'top', marginTop: 6, lineHeight: 19 },
  noteSaveBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9, marginTop: 8 },
  noteSaveText: { fontSize: 12.5, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  stateChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9 },
  stateChipText: { fontSize: 11.5, fontWeight: '800' },
  header: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  photo: { width: 76, height: 76, borderRadius: 18 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1 },
  skillBadge: { minWidth: 21, height: 19, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  skillBadgeText: { color: '#fff', fontSize: 11.5, fontWeight: '900' },
  intro: { fontSize: 13, fontWeight: '600', marginTop: 4, lineHeight: 18 },
  msgCard: { borderRadius: 14, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  offerCard: { borderRadius: 14, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  offerLabel: { fontSize: 11.5, fontWeight: '800', marginBottom: 4 },
  offerText: { fontSize: 14.5, fontWeight: '800' },
  offerMsg: { fontSize: 12.5, fontWeight: '600', marginTop: 4, lineHeight: 18 },
  offerForm: { gap: spacing.sm },
  offerFormTitle: { fontSize: 14.5, fontWeight: '800' },
  offerInput: { fontSize: 13.5, fontWeight: '600', borderWidth: 1, borderRadius: 11, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'web' ? 10 : 9 },
  waitBadge: { alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingVertical: 14 },
  waitText: { fontSize: 13, fontWeight: '800' },
  msgLabel: { fontSize: 11.5, fontWeight: '800', marginBottom: 4 },
  msgText: { fontSize: 13.5, fontWeight: '600', lineHeight: 20 },
  actionBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: 'row', gap: spacing.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  ghostBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderRadius: 13, paddingVertical: 14 },
  ghostText: { fontSize: 14, fontWeight: '800' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, paddingVertical: 14 },
  primaryText: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
});

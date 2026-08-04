import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, Modal, TextInput, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { ResumeDocument } from '../../components/market/ResumeDocument';
import { coachApi, coachChatApi, type CoachDetail } from '../../services/coach';
import { coachJobApi, type MyJobRow } from '../../services/coachJob';
import { showSuccess } from '../../utils/feedback';
import { absolutizeUploadUrl } from '../../services/upload';
import { useAuthStore } from '../../store/authStore';

// ─────────────────────────────────────────────────────────────
// 코치 프로필(공개) — 숨고식 히어로 + 이력서 문서(ResumeDocument 공용).
// ─────────────────────────────────────────────────────────────

export default function CoachProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myUserId = useAuthStore((s) => s.user?.id);

  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // 스카웃 — 내가 관리하는 OPEN 공고가 있으면 [내 공고로 제안] 노출
  const [myJobs, setMyJobs] = useState<MyJobRow[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [invitePostId, setInvitePostId] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!id) return;
    coachApi
      .get(id)
      .then(setCoach)
      .catch(() => {})
      .finally(() => setLoading(false));
    coachJobApi.mine().then((r) => setMyJobs(r.filter((j) => j.status === 'OPEN'))).catch(() => {});
  }, [id]);

  const isMe = !!coach && coach.userId === myUserId;

  const startChat = async () => {
    if (!coach || starting) return;
    setStarting(true);
    try {
      const thread = await coachChatApi.start(coach.id);
      router.push(`/coach-chat/${thread.threadId}` as never);
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setStarting(false);
    }
  };

  const sendInvite = async () => {
    if (!coach || !invitePostId || inviting) return;
    setInviting(true);
    try {
      await coachJobApi.invite(invitePostId, coach.id, inviteMsg.trim() || undefined);
      showSuccess(`${coach.displayName} 코치에게 제안을 보냈어요`);
      setShowInvite(false);
      setInvitePostId(null);
      setInviteMsg('');
    } catch { /* noop */ } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!coach) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={styles.topBarFloating}><BackButton /></View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.textLight} />
          <Text style={{ ...typography.body1, color: colors.textSecondary }}>코치를 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  const photo = absolutizeUploadUrl(coach.photoUrl);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>{coach.displayName} 코치</Text>
        {isMe && (
          <Pressable onPress={() => router.push('/coach/resume' as never)} hitSlop={8}>
            <Text style={[styles.editLink, { color: colors.primary }]}>프로필 수정</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}>
        {/* 히어로(숨고식) */}
        <View style={styles.header}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoFallback, { backgroundColor: colors.primary + '10' }]}>
              <Text style={[styles.photoInitial, { color: colors.primary }]}>{coach.displayName.slice(0, 1)}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{coach.displayName}</Text>
              {coach.certified && (
                <View style={[styles.certBadge, { backgroundColor: colors.primary + '14' }]}>
                  <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                  <Text style={[styles.certText, { color: colors.primary }]}>인증 코치</Text>
                </View>
              )}
            </View>
            {!!coach.intro && <Text style={[styles.intro, { color: colors.textSecondary }]} numberOfLines={2}>{coach.intro}</Text>}
            {!!coach.regions && (
              <View style={styles.regionRow}>
                <Ionicons name="location-outline" size={12} color={colors.textLight} />
                <Text style={[styles.regionText, { color: colors.textLight }]} numberOfLines={1}>{coach.regions}</Text>
              </View>
            )}
            {!coach.active && (
              <Text style={[styles.inactive, { color: colors.textLight }]}>지금은 비공개 상태예요 (본인에게만 보임)</Text>
            )}
          </View>
        </View>

        <ResumeDocument coach={coach} isMe={isMe} />

        {!isMe && (
          <View style={[styles.howCard, { borderColor: colors.border }]}>
            <Text style={[styles.howTitle, { color: colors.text }]}>이 코치와 레슨을 여는 방법</Text>
            <Text style={[styles.howText, { color: colors.textSecondary }]}>
              1. 채팅으로 요일·시간·레슨비를 협의해요{'\n'}
              2. 모임 관리 → 레슨에서 "등록 코치 연결"로 레슨을 개설해요{'\n'}
              3. 회원 신청을 받으면 코치와 함께 수강생·출석을 관리해요
            </Text>
          </View>
        )}
      </ScrollView>

      {!isMe && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md), flexDirection: 'row', gap: spacing.sm }]}>
          {myJobs.length > 0 && (
            <Pressable
              onPress={() => { setInvitePostId(myJobs[0]?.id ?? null); setShowInvite(true); }}
              style={({ pressed }) => [styles.inviteBtn, { borderColor: colors.primary }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="megaphone-outline" size={16} color={colors.primary} />
              <Text style={[styles.inviteText, { color: colors.primary }]}>내 공고로 제안</Text>
            </Pressable>
          )}
          <Pressable
            onPress={startChat}
            disabled={starting}
            style={({ pressed }) => [styles.chatBtn, { backgroundColor: colors.primary, flex: 1.4 }, (pressed || starting) && { opacity: 0.85 }]}
          >
            {starting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                <Text style={styles.chatText}>채팅으로 레슨 문의</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* 스카웃 — 내 공고 선택 + 메시지 */}
      <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setShowInvite(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>어떤 공고로 제안할까요?</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {myJobs.map((j) => {
                const on = invitePostId === j.id;
                return (
                  <Pressable
                    key={j.id}
                    onPress={() => setInvitePostId(j.id)}
                    style={[styles.jobPick, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '0C' : 'transparent' }]}
                  >
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={16} color={on ? colors.primary : colors.textLight} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.jobPickTitle, { color: colors.text }]} numberOfLines={1}>{j.title}</Text>
                      <Text style={[styles.jobPickMeta, { color: colors.textLight }]} numberOfLines={1}>{j.payLabel} · 지원 {j.applicants}명</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              style={[styles.inviteInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
              value={inviteMsg}
              onChangeText={setInviteMsg}
              placeholder="한마디 (선택 — 예: 프로필 보고 연락드려요, 주말 레슨 가능하실까요?)"
              placeholderTextColor={colors.textLight}
              multiline
              maxLength={300}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable onPress={() => setShowInvite(false)} style={[styles.sheetGhost, { borderColor: colors.border }]}>
                <Text style={[styles.sheetGhostText, { color: colors.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable onPress={sendInvite} disabled={inviting || !invitePostId} style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: colors.primary }, (pressed || inviting || !invitePostId) && { opacity: 0.7 }]}>
                {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>제안 보내기</Text>}
              </Pressable>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  inviteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14 },
  inviteText: { fontSize: 14, fontWeight: '800' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.xl },
  sheet: { borderRadius: 18, padding: spacing.lg, maxWidth: 480, width: '100%', alignSelf: 'center', gap: spacing.md },
  sheetTitle: { ...typography.subtitle1 },
  jobPick: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  jobPickTitle: { fontSize: 14, fontWeight: '800' },
  jobPickMeta: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },
  inviteInput: { fontSize: 13.5, fontWeight: '600', borderWidth: 1, borderRadius: 12, padding: spacing.md, minHeight: 64, textAlignVertical: 'top' },
  sheetGhost: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  sheetGhostText: { fontSize: 14, fontWeight: '800' },
  sheetPrimary: { flex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 13 },
  sheetPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  topBarFloating: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  topTitle: { ...typography.subtitle1, flex: 1 },
  editLink: { fontSize: 14, fontWeight: '800' },
  header: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg },
  photo: { width: 92, height: 92, borderRadius: 20 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoInitial: { fontSize: 34, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1 },
  certBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  certText: { fontSize: 11, fontWeight: '800' },
  intro: { fontSize: 13.5, fontWeight: '600', marginTop: 5, lineHeight: 19 },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  regionText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  inactive: { fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
  howCard: { borderWidth: 1, borderRadius: 16, padding: spacing.lg, marginTop: spacing.xs },
  howTitle: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  howText: { fontSize: 13, fontWeight: '600', lineHeight: 21 },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  chatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 15, borderRadius: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  chatText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});

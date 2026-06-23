import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useChatStore } from '../../../store/chatStore';
import { useClubStore } from '../../../store/clubStore';
import { useAuthStore } from '../../../store/authStore';
import { useClubRoom, useSocketEvent } from '../../../hooks/useSocket';
import { useTheme } from '../../../hooks/useTheme';
import { BackButton } from '../../../components/ui/BackButton';
import { getSkillMeta } from '../../../constants/skill';
import { ClubMessage } from '../../../services/chat';
import { typography, spacing, radius } from '../../../constants/theme';
import { showError } from '../../../utils/feedback';

// 시:분 (오전/오후) 형식. 24h → 한국어 오전/오후 12h.
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  h = h % 12;
  if (h === 0) h = 12;
  return `${ampm} ${h}:${String(m).padStart(2, '0')}`;
}

// 급수 letter 칩 (미설정은 "—").
function SkillChip({ level }: { level: string | null }) {
  const meta = getSkillMeta(level);
  return (
    <View style={[chipStyles.skill, { backgroundColor: meta.color }]}>
      <Text style={chipStyles.skillText}>{meta.level}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  skill: {
    minWidth: 18,
    height: 18,
    borderRadius: 5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});

export default function ClubChatScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuthStore();
  const { currentMembers, fetchMembers, clubs } = useClubStore();
  const { messagesByClub, loadingByClub, fetchMessages, sendMessage, appendMessage } =
    useChatStore();

  const messages = (clubId && messagesByClub[clubId]) || [];
  const loading = !!(clubId && loadingByClub[clubId]);
  const club = clubs.find((c) => c.id === clubId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const listRef = useRef<FlatList<ClubMessage>>(null);

  // 실시간: club:<clubId> 룸 참여 + 'clubMessage:new' append.
  useClubRoom(clubId);
  const handleNew = useCallback(
    (msg: ClubMessage) => {
      if (msg.clubId === clubId) appendMessage(msg);
    },
    [clubId, appendMessage],
  );
  useSocketEvent<ClubMessage>('clubMessage:new', handleNew);

  useEffect(() => {
    if (!clubId) return;
    fetchMessages(clubId);
    fetchMembers(clubId);
  }, [clubId]);

  // 새 메시지가 들어오면 맨 아래로 스크롤 (web/native 모두 안전).
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);
  useEffect(() => {
    if (messages.length > 0) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  // 짝 요청 후보 = 나를 제외한 모임원.
  const candidates = useMemo(
    () => currentMembers.filter((m) => m.userId !== user?.id),
    [currentMembers, user?.id],
  );

  const togglePick = (userId: string) => {
    setPicked((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length >= 4
          ? prev // 최대 4명
          : [...prev, userId],
    );
  };

  const doSend = useCallback(
    async (type: 'CHAT' | 'REQUEST', mentionedUserIds?: string[]) => {
      if (!clubId) return;
      const body = text.trim();
      // REQUEST 는 본문이 비어도 자동 텍스트로 전송 가능.
      if (type === 'CHAT' && !body) return;
      setSending(true);
      try {
        await sendMessage(clubId, {
          text: body || ' ',
          type,
          ...(mentionedUserIds && mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
        });
        setText('');
        scrollToEnd();
      } catch (err: any) {
        showError(err?.response?.data?.error || '메시지 전송에 실패했어요');
      } finally {
        setSending(false);
      }
    },
    [clubId, text, sendMessage, scrollToEnd],
  );

  // 짝 요청 전송: 지목한 모임원 이름으로 본문 자동 작성 ([짝 요청] OOO, XXX ...).
  const submitRequest = useCallback(async () => {
    if (picked.length === 0) return;
    const names = candidates
      .filter((m) => picked.includes(m.userId))
      .map((m) => m.name);
    const note = text.trim();
    const auto = `[짝 요청] ${names.join(', ')} 같이 치고 싶어요`;
    const finalText = note ? `${auto} — ${note}` : auto;
    if (!clubId) return;
    setSending(true);
    try {
      await sendMessage(clubId, {
        text: finalText,
        type: 'REQUEST',
        mentionedUserIds: picked,
      });
      setText('');
      setPicked([]);
      setPickerOpen(false);
      scrollToEnd();
    } catch (err: any) {
      showError(err?.response?.data?.error || '짝 요청 전송에 실패했어요');
    } finally {
      setSending(false);
    }
  }, [picked, candidates, text, clubId, sendMessage, scrollToEnd]);

  const renderItem = useCallback(
    ({ item }: { item: ClubMessage }) => {
      const isMine = item.userId === user?.id;
      const isRequest = item.type === 'REQUEST';
      return (
        <View style={[styles.row, isMine && styles.rowMine]}>
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: isRequest
                  ? colors.warningBg
                  : isMine
                    ? colors.primaryLight
                    : colors.surface,
                borderColor: isRequest ? colors.warning : colors.border,
              },
            ]}
          >
            <View style={styles.bubbleHeader}>
              <SkillChip level={item.authorSkillLevel} />
              <Text style={[styles.author, { color: colors.text }]} numberOfLines={1}>
                {item.authorName}
                {isMine ? ' (나)' : ''}
              </Text>
              {isRequest && (
                <View style={[styles.requestBadge, { backgroundColor: colors.warning }]}>
                  <Text style={styles.requestBadgeText}>🙋 짝 요청</Text>
                </View>
              )}
            </View>

            <Text style={[styles.text, { color: colors.text }]}>{item.text}</Text>

            {isRequest && item.mentioned.length > 0 && (
              <View style={styles.mentionRow}>
                {item.mentioned.map((p) => (
                  <View
                    key={p.userId}
                    style={[styles.mentionChip, { backgroundColor: colors.warningLight, borderColor: colors.warning }]}
                  >
                    <Text style={[styles.mentionChipText, { color: colors.text }]}>@{p.name}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={[styles.time, { color: colors.textLight }]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      );
    },
    [user?.id, colors],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Custom header: BackButton always present (falls back to this club on
            deep-link/reload where the Stack auto-back would vanish). */}
        <View style={[styles.topHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <BackButton
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace(`/club/${clubId}`)
            }
          />
          <Text style={[styles.topHeaderTitle, { color: colors.text }]} numberOfLines={1}>
            {`${club?.name || '모임'} 채팅/건의`}
          </Text>
        </View>
        {loading && messages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
              아직 메시지가 없어요
            </Text>
            <Text style={[styles.emptySub, { color: colors.textLight }]}>
              인사를 남기거나 "🙋 짝 요청"으로 같이 칠 사람을 모아보세요
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToEnd}
            onLayout={scrollToEnd}
          />
        )}

        {/* 입력 바 + 짝 요청 토글 */}
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.requestToggle, { borderColor: colors.warning, backgroundColor: colors.warningBg }]}
            onPress={() => {
              setPicked([]);
              setPickerOpen(true);
            }}
            accessibilityLabel="짝 요청"
          >
            <Text style={styles.requestToggleText}>🙋</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            value={text}
            onChangeText={setText}
            placeholder="메시지를 입력하세요"
            placeholderTextColor={colors.textLight}
            multiline
            maxLength={500}
            onSubmitEditing={() => doSend('CHAT')}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: text.trim() && !sending ? colors.primary : colors.surface3 },
            ]}
            onPress={() => doSend('CHAT')}
            disabled={!text.trim() || sending}
            accessibilityLabel="보내기"
          >
            <Text style={[styles.sendText, { color: text.trim() && !sending ? '#fff' : colors.textLight }]}>
              보내기
            </Text>
          </TouchableOpacity>
        </View>

        {/* 짝 요청 멤버 픽커 (1~4명) */}
        <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>🙋 짝 요청</Text>
                <TouchableOpacity onPress={() => setPickerOpen(false)} accessibilityLabel="닫기">
                  <Text style={[styles.modalClose, { color: colors.textLight }]}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
                같이 치고 싶은 모임원을 골라주세요 (최대 4명)
              </Text>

              <ScrollView style={styles.pickerList}>
                {candidates.length === 0 ? (
                  <Text style={[styles.emptySub, { color: colors.textLight, padding: spacing.lg }]}>
                    선택할 다른 모임원이 없어요
                  </Text>
                ) : (
                  candidates.map((m) => {
                    const sel = picked.includes(m.userId);
                    return (
                      <TouchableOpacity
                        key={m.userId}
                        style={[
                          styles.pickerRow,
                          { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primaryBg : colors.surface },
                        ]}
                        onPress={() => togglePick(m.userId)}
                        accessibilityLabel={`${m.name} ${sel ? '선택 해제' : '선택'}`}
                      >
                        <SkillChip level={m.skillLevel} />
                        <Text style={[styles.pickerName, { color: colors.text }]}>{m.name}</Text>
                        <View style={[styles.checkbox, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : 'transparent' }]}>
                          {sel && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>

              <TextInput
                style={[styles.noteInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                value={text}
                onChangeText={setText}
                placeholder="한마디 덧붙이기 (선택)"
                placeholderTextColor={colors.textLight}
                maxLength={400}
              />

              <TouchableOpacity
                style={[
                  styles.requestSubmit,
                  { backgroundColor: picked.length > 0 && !sending ? colors.warning : colors.surface3 },
                ]}
                onPress={submitRequest}
                disabled={picked.length === 0 || sending}
              >
                <Text style={[styles.requestSubmitText, { color: picked.length > 0 ? '#fff' : colors.textLight }]}>
                  {sending ? '보내는 중...' : `짝 요청 보내기${picked.length > 0 ? ` (${picked.length})` : ''}`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: spacing.smd,
    borderBottomWidth: 1,
  },
  topHeaderTitle: {
    ...typography.subtitle1,
    flex: 1,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { ...typography.subtitle1 },
  emptySub: { ...typography.body2, textAlign: 'center', marginTop: spacing.sm },
  listContent: { padding: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },

  row: { flexDirection: 'row', justifyContent: 'flex-start' },
  rowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  author: { ...typography.caption, fontWeight: '700', flexShrink: 1 },
  requestBadge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  requestBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  text: { ...typography.body2 },
  mentionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  mentionChip: { borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  mentionChipText: { fontSize: 12, fontWeight: '700' },
  time: { ...typography.caption, marginTop: spacing.xs, alignSelf: 'flex-end' },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
  },
  requestToggle: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestToggleText: { fontSize: 20 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body2,
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { ...typography.button },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: radius.banner, borderTopRightRadius: radius.banner, padding: spacing.xl, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  modalTitle: { ...typography.h3 },
  modalClose: { fontSize: 22, padding: spacing.xs },
  modalDesc: { ...typography.body2, marginBottom: spacing.md },
  pickerList: { maxHeight: 320 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  pickerName: { ...typography.subtitle2, flex: 1 },
  checkbox: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  noteInput: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    ...typography.body2,
  },
  requestSubmit: { borderRadius: radius.xl, paddingVertical: spacing.lg, alignItems: 'center' },
  requestSubmitText: { ...typography.button, fontSize: 16 },
});

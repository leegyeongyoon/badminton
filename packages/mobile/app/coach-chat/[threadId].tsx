import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { ChatThread } from '../../components/chat/ChatThread';
import { coachChatApi, type CoachChatThread } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';

// ─────────────────────────────────────────────────────────────
// 코치 문의 대화 — /coach-chat/:threadId. ChatThread 재사용(코치=staff 측 매핑).
// 열려 있는 동안 5초 폴링.
// ─────────────────────────────────────────────────────────────

export default function CoachChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [conv, setConv] = useState<CoachChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const t = await coachChatApi.load(threadId);
      setConv((prev) => (prev && prev.messages.length === t.messages.length && t.messages.length > 0 ? prev : t));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const send = async (text: string) => {
    if (!threadId) return;
    setSending(true);
    setConv((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              { id: `tmp-${Date.now()}`, fromCoach: prev.mineIsCoach, authorName: '나', text, createdAt: new Date().toISOString() },
            ],
          }
        : prev,
    );
    try {
      await coachChatApi.send(threadId, text);
      const t = await coachChatApi.load(threadId);
      setConv(t);
    } catch {
      /* noop */
    } finally {
      setSending(false);
    }
  };

  // 상대 표시: 내가 코치면 문의자 이름, 아니면 코치 이름(+사진·인증).
  const counterpartName = conv ? (conv.mineIsCoach ? conv.userName : `${conv.coach.displayName} 코치`) : '';
  const photo = conv && !conv.mineIsCoach ? absolutizeUploadUrl(conv.coach.photoUrl) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <BackButton />
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} />
        ) : null}
        <Pressable
          style={{ flex: 1, minWidth: 0 }}
          disabled={!conv || conv.mineIsCoach || !conv.coach.profileId}
          onPress={() => conv?.coach.profileId && router.push(`/coach/${conv.coach.profileId}` as never)}
        >
          <View style={styles.nameRow}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{counterpartName || '대화'}</Text>
            {conv && !conv.mineIsCoach && conv.coach.certified && (
              <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
            )}
          </View>
          <Text style={[styles.sub, { color: colors.textLight }]} numberOfLines={1}>
            {conv?.clubName
              ? `${conv.clubName} 레슨 협의`
              : conv?.mineIsCoach
                ? '레슨 문의에 답장해요'
                : '요일·시간·레슨비를 협의해 보세요'}
          </Text>
        </Pressable>
      </View>

      <ChatThread
        messages={(conv?.messages ?? []).map((m) => ({
          id: m.id,
          fromStaff: m.fromCoach,
          authorName: m.authorName,
          text: m.text,
          createdAt: m.createdAt,
        }))}
        mineIsStaff={conv?.mineIsCoach ?? false}
        loading={loading}
        sending={sending}
        placeholder="메시지 입력"
        emptyHint={conv?.mineIsCoach ? '문의가 도착하면 여기서 답장해요' : '코치에게 첫 메시지를 보내보세요'}
        onSend={send}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { ...typography.subtitle1, flexShrink: 1 },
  sub: { ...typography.caption, marginTop: 1 },
});

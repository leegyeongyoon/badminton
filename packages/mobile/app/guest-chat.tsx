import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing } from '../constants/theme';
import { BackButton } from '../components/ui/BackButton';
import { ChatThread, type ChatBubble } from '../components/chat/ChatThread';
import { guestChatApi, type GuestChatThread } from '../services/guestChat';
import { getItem, setItem } from '../services/storage';

// ─────────────────────────────────────────────────────────────
// 게스트 문의 채팅(공개) — /guest-chat?code=<초대코드> 또는 ?clubId=<id>
// 비회원도 로그인 없이 운영진에게 문의. threadId를 기기에 저장해 재방문 시 이어봄.
// 열려있는 동안 5초 폴링으로 운영진 답장을 받아온다.
// ─────────────────────────────────────────────────────────────

const threadKey = (clubKey: string) => `guestthread_${clubKey}`;

export default function GuestChat() {
  const { code, clubId, name, threadId: threadIdParam } = useLocalSearchParams<{ code?: string; clubId?: string; name?: string; threadId?: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const clubKey = String(clubId || code || '');

  const [thread, setThread] = useState<GuestChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const threadIdRef = useRef<string | null>(null);

  // 최초: 저장된 threadId 있으면 로드, 없으면 스레드 시작.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 푸시 딥링크(?threadId=)가 최우선 — 저장 토큰/시작보다 먼저.
        const saved = threadIdParam ? String(threadIdParam) : clubKey ? await getItem(threadKey(clubKey)) : null;
        let t: GuestChatThread;
        if (saved) {
          try {
            t = await guestChatApi.load(saved);
          } catch {
            // 저장된 토큰이 죽었으면 새로 시작.
            t = await guestChatApi.start({ clubId, inviteCode: code, name: name ? String(name) : undefined });
          }
        } else {
          if (!code && !clubId) throw new Error('no-entry');
          t = await guestChatApi.start({ clubId, inviteCode: code, name: name ? String(name) : undefined });
        }
        if (!alive) return;
        threadIdRef.current = t.threadId;
        if (clubKey) await setItem(threadKey(clubKey), t.threadId);
        setThread(t);
      } catch {
        if (alive) setThread(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clubKey, code, clubId, name, threadIdParam]);

  // 폴링 — 열려있는 동안 5초마다 갱신(내가 보는 화면이라 안 읽음도 리셋됨).
  const refresh = useCallback(async () => {
    const id = threadIdRef.current;
    if (!id) return;
    try {
      const t = await guestChatApi.load(id);
      setThread((prev) => (prev && prev.messages.length === t.messages.length && t.messages.length > 0 ? prev : t));
    } catch {
      /* noop */
    }
  }, []);
  useEffect(() => {
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const send = async (text: string) => {
    const id = threadIdRef.current;
    if (!id) return;
    setSending(true);
    // 낙관적 반영.
    const optimistic: ChatBubble = { id: `tmp-${Date.now()}`, fromStaff: false, authorName: thread?.guestName || '나', text, createdAt: new Date().toISOString() };
    setThread((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    try {
      await guestChatApi.send(id, text, name ? String(name) : undefined);
      await refresh();
    } catch {
      /* 전송 실패 — 폴링이 정리 */
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <BackButton />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {thread ? `${thread.clubName} 문의` : '운영진에게 문의'}
          </Text>
          <Text style={[styles.sub, { color: colors.textLight }]}>운영진이 확인하면 답장을 드려요</Text>
        </View>
      </View>

      {!loading && !thread ? (
        <View style={styles.center}>
          <Text style={[styles.errText, { color: colors.textSecondary }]}>대화를 열 수 없어요. 링크를 다시 확인해 주세요.</Text>
        </View>
      ) : (
        <ChatThread
          messages={thread?.messages ?? []}
          mineIsStaff={false}
          loading={loading}
          sending={sending}
          placeholder="궁금한 점을 입력하세요"
          emptyHint={'예: 이번 주 토요일 게스트 가도 되나요?\n급수·인원·주차 등 무엇이든 물어보세요'}
          onSend={send}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1 },
  sub: { ...typography.caption, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errText: { ...typography.body2, textAlign: 'center' },
});

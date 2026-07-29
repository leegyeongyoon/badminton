import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing, radius } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { ChatThread } from '../../../components/chat/ChatThread';
import { staffGuestChatApi, type StaffThreadRow, type GuestChatThread } from '../../../services/guestChat';
import { clubApi } from '../../../services/club';

// ─────────────────────────────────────────────────────────────
// 게스트 문의함(운영진) — /club/:id/guest-inbox
// 왼쪽: 스레드 목록(미읽음 뱃지). 스레드 선택 → 대화(운영진 답장).
// 대화 열려있는 동안 5초 폴링.
// ─────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function GuestInbox() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [clubName, setClubName] = useState('');
  const [threads, setThreads] = useState<StaffThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [conv, setConv] = useState<GuestChatThread | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const openIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    clubApi.list().then(({ data }) => {
      const c = (data || []).find((x: any) => x.id === clubId);
      if (c) setClubName(c.name);
    }).catch(() => {});
  }, [clubId]);

  const loadList = useCallback(async () => {
    if (!clubId) return;
    try {
      setThreads(await staffGuestChatApi.list(clubId));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);
  useEffect(() => { loadList(); }, [loadList]);

  // 목록 화면일 때만 20초 폴링(대화 중엔 대화 폴링).
  useEffect(() => {
    if (openId) return;
    const iv = setInterval(loadList, 20000);
    return () => clearInterval(iv);
  }, [openId, loadList]);

  const openThread = async (threadId: string) => {
    if (!clubId) return;
    setOpenId(threadId);
    openIdRef.current = threadId;
    setConv(null);
    setConvLoading(true);
    try {
      setConv(await staffGuestChatApi.load(clubId, threadId));
    } catch {
      /* noop */
    } finally {
      setConvLoading(false);
    }
    loadList(); // 미읽음 리셋 반영
  };

  const refreshConv = useCallback(async () => {
    const id = openIdRef.current;
    if (!clubId || !id) return;
    try {
      const t = await staffGuestChatApi.load(clubId, id);
      setConv((prev) => (prev && prev.messages.length === t.messages.length && t.messages.length > 0 ? prev : t));
    } catch {
      /* noop */
    }
  }, [clubId]);
  useEffect(() => {
    if (!openId) return;
    const iv = setInterval(refreshConv, 5000);
    return () => clearInterval(iv);
  }, [openId, refreshConv]);

  const closeThreadView = () => {
    setOpenId(null);
    openIdRef.current = null;
    setConv(null);
    loadList();
  };

  const send = async (text: string) => {
    const id = openIdRef.current;
    if (!clubId || !id) return;
    setSending(true);
    setConv((prev) => (prev ? { ...prev, messages: [...prev.messages, { id: `tmp-${Date.now()}`, fromStaff: true, authorName: '나', text, createdAt: new Date().toISOString() }] } : prev));
    try {
      await staffGuestChatApi.send(clubId, id, text);
      await refreshConv();
    } catch {
      /* noop */
    } finally {
      setSending(false);
    }
  };

  // ── 대화 화면 ──
  if (openId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Pressable onPress={closeThreadView} hitSlop={10} style={styles.backHit}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {conv?.guestName || '게스트'} 문의
            </Text>
            <Text style={[styles.sub, { color: colors.textLight }]}>게스트에게 답장해요</Text>
          </View>
        </View>
        <ChatThread
          messages={conv?.messages ?? []}
          mineIsStaff
          loading={convLoading}
          sending={sending}
          placeholder="답장 입력"
          emptyHint="게스트의 첫 문의를 기다리고 있어요"
          onSend={send}
        />
      </View>
    );
  }

  // ── 목록 화면 ──
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {clubName ? `${clubName} · 게스트 문의` : '게스트 문의'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadList(); }} tintColor={colors.primary} />}
        >
          {threads.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubbles-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 게스트 문의가 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                게스트 신청 페이지에서 "운영진에게 문의하기"로 들어온 대화가 여기 쌓여요
              </Text>
            </View>
          ) : (
            threads.map((t) => (
              <Pressable
                key={t.threadId}
                onPress={() => openThread(t.threadId)}
                style={[styles.threadRow, { backgroundColor: colors.surface }, shadows.sm, t.closed && { opacity: 0.6 }]}
              >
                <View style={[styles.avatar, { backgroundColor: (t.staffUnread > 0 ? colors.primary : colors.textLight) + '22' }]}>
                  <Text style={[styles.avatarText, { color: t.staffUnread > 0 ? colors.primary : colors.textLight }]}>
                    {(t.guestName || '게')?.slice(0, 1)}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.threadHead}>
                    <Text style={[styles.threadName, { color: colors.text }]} numberOfLines={1}>{t.guestName || '게스트'}</Text>
                    {t.isAppUser && (
                      <View style={[styles.tag, { backgroundColor: colors.info + '22' }]}>
                        <Text style={[styles.tagText, { color: colors.info }]}>앱 회원</Text>
                      </View>
                    )}
                    {t.closed && <Text style={[styles.closedTag, { color: colors.textLight }]}>종료</Text>}
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.threadTime, { color: colors.textLight }]}>{relTime(t.lastMessageAt)}</Text>
                  </View>
                  <View style={styles.threadPreviewRow}>
                    <Text style={[styles.threadPreview, { color: t.staffUnread > 0 ? colors.text : colors.textSecondary }]} numberOfLines={1}>
                      {t.lastText || '(내용 없음)'}
                    </Text>
                    {t.staffUnread > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: colors.danger }]}>
                        <Text style={styles.unreadText}>{t.staffUnread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  backHit: { paddingVertical: spacing.sm, paddingRight: spacing.xs },
  title: { ...typography.subtitle1, flex: 1 },
  sub: { ...typography.caption, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.xl },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '900' },
  threadHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  threadName: { ...typography.subtitle2, fontWeight: '800', flexShrink: 1 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  tagText: { fontSize: 10, fontWeight: '800' },
  closedTag: { fontSize: 10, fontWeight: '800' },
  threadTime: { ...typography.caption },
  threadPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  threadPreview: { ...typography.body2, flex: 1 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});

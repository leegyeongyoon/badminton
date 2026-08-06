import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachChatApi, type CoachThreadRow } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';

// ─────────────────────────────────────────────────────────────
// 코치 채팅 — 용도별 탭으로 분리: [레슨 문의] 코치↔회원 레슨 대화,
// [채용] 공고 면접·오퍼 대화(스레드에 공고명 태그). 각 탭 안에서
// 받은(코치)/보낸(문의자) 섹션 구분은 유지.
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

export default function CoachInbox() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [asUser, setAsUser] = useState<CoachThreadRow[]>([]);
  const [asCoach, setAsCoach] = useState<CoachThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'LESSON' | 'RECRUIT'>('LESSON');

  const load = useCallback(async () => {
    try {
      const t = await coachChatApi.threads();
      setAsUser(t.asUser);
      setAsCoach(t.asCoach);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  const renderRow = (t: CoachThreadRow) => {
    const photo = absolutizeUploadUrl(t.counterpartPhotoUrl);
    return (
      <Pressable
        key={t.threadId}
        onPress={() => router.push(`/coach-chat/${t.threadId}` as never)}
        style={({ pressed }) => [styles.row, { backgroundColor: colors.surface }, shadows.md, pressed && { opacity: 0.92 }]}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: (t.unread > 0 ? colors.primary : colors.textLight) + '22' }]}>
            <Text style={[styles.avatarText, { color: t.unread > 0 ? colors.primary : colors.textLight }]}>
              {t.counterpartName.slice(0, 1)}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.head}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{t.counterpartName}</Text>
            {t.certified && <Ionicons name="checkmark-circle" size={13} color={colors.primary} />}
            {t.kind === 'RECRUIT' && !!t.jobTitle && (
              <Text style={[styles.jobTag, { color: colors.textSecondary }]} numberOfLines={1}>{t.jobTitle}</Text>
            )}
            {t.kind !== 'RECRUIT' && !!t.clubName && (
              <Text style={[styles.clubTag, { color: colors.textLight }]} numberOfLines={1}>{t.clubName}</Text>
            )}
            <View style={{ flex: 1 }} />
            <Text style={[styles.time, { color: colors.textLight }]}>{relTime(t.lastMessageAt)}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={[styles.preview, { color: t.unread > 0 ? colors.text : colors.textSecondary }]} numberOfLines={1}>
              {t.lastText || '(내용 없음)'}
            </Text>
            {t.unread > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.danger }]}>
                <Text style={styles.unreadText}>{t.unread}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const fAsUser = asUser.filter((t) => (t.kind === 'RECRUIT') === (tab === 'RECRUIT'));
  const fAsCoach = asCoach.filter((t) => (t.kind === 'RECRUIT') === (tab === 'RECRUIT'));
  const recruitUnread = [...asUser, ...asCoach].filter((t) => t.kind === 'RECRUIT').reduce((s2, t) => s2 + t.unread, 0);
  const lessonUnread = [...asUser, ...asCoach].filter((t) => t.kind !== 'RECRUIT').reduce((s2, t) => s2 + t.unread, 0);
  const empty = fAsUser.length === 0 && fAsCoach.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>코치 채팅</Text>
      </View>

      {/* 용도별 탭 — 레슨 문의 / 채용 */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        {([
          { key: 'LESSON', label: '레슨 문의', unread: lessonUnread },
          { key: 'RECRUIT', label: '채용', unread: recruitUnread },
        ] as const).map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabItem, on && { borderBottomColor: colors.primary }]}>
              <Text style={[styles.tabLabel, { color: on ? colors.primary : colors.textSecondary }]}>{t.label}</Text>
              {t.unread > 0 && (
                <View style={[styles.tabBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.tabBadgeText}>{t.unread}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {empty ? (
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubbles-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {tab === 'LESSON' ? '아직 레슨 문의가 없어요' : '아직 채용 대화가 없어요'}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                {tab === 'LESSON'
                  ? '코치 찾기에서 코치에게 문의하거나,\n코치 프로필을 등록해 문의를 받아보세요'
                  : '공고 지원이 면접 단계로 넘어가면\n여기서 공고 측과 대화하게 돼요'}
              </Text>
            </View>
          ) : (
            <>
              {fAsCoach.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textLight }]}>{tab === 'LESSON' ? '받은 문의 (코치)' : '받은 대화 (코치)'}</Text>
                  {fAsCoach.map(renderRow)}
                </>
              )}
              {fAsUser.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textLight, marginTop: fAsCoach.length > 0 ? spacing.lg : 0 }]}>
                    {tab === 'LESSON' ? '보낸 문의' : '보낸 대화 (공고 측)'}
                  </Text>
                  {fAsUser.map(renderRow)}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginBottom: spacing.sm, marginLeft: 4, letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.sm + 2 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...typography.subtitle2, fontWeight: '600', flexShrink: 1 },
  clubTag: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  jobTag: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabLabel: { fontSize: 14, fontWeight: '600' },
  tabBadge: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  time: { ...typography.caption },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  preview: { ...typography.body2, flex: 1 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

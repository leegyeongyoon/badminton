import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { getSkillMeta } from '../../constants/skill';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, coachChatApi, type CoachDetail } from '../../services/coach';
import { coachJobApi } from '../../services/coachJob';
import { absolutizeUploadUrl } from '../../services/upload';
import { ComingSoon } from '../../components/market/ComingSoon';
import { COACH_MARKET_ENABLED } from '../../constants/features';

// ─────────────────────────────────────────────────────────────
// MY코치 (원티드 MY원티드) — 구인·구직 내 활동의 마이페이지 허브.
//  프로필 카드(완성도) / 지원 현황 / 채용 관리 / 코치 프로필 / 채팅 / 내 레슨
// ─────────────────────────────────────────────────────────────

export default function MarketMy() {
  if (!COACH_MARKET_ENABLED) return <ComingSoon />;
  return <MarketMyInner />;
}

function MarketMyInner() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [myJobCount, setMyJobCount] = useState(0);
  const [newApplicants, setNewApplicants] = useState(0);
  const [myAppCount, setMyAppCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [inviteCount, setInviteCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      coachApi.me().then(setProfile).catch(() => {}).finally(() => setLoading(false));
      coachJobApi.mine().then((r) => {
        setMyJobCount(r.length);
        setNewApplicants(r.reduce((sum, j) => sum + j.newApplicants, 0));
      }).catch(() => {});
      coachJobApi.applied().then((r) => setMyAppCount(r.length)).catch(() => {});
      coachChatApi.unreadCount().then(setChatUnread).catch(() => {});
      coachJobApi.invites().then((r) => setInviteCount(r.filter((i) => i.status === 'SENT' && !i.applied).length)).catch(() => {});
    }, []),
  );

  // 프로필 완성도(리스트/문서 화면과 동일 기준의 요약판)
  const completion = (() => {
    if (!profile) return 0;
    const entries = profile.careerEntries ?? [];
    const items = [
      !!profile.photoUrl, !!profile.intro, profile.birthYear != null, profile.playingYears != null,
      !!profile.skillLevel,
      entries.some((e) => e.kind === 'PLAYER' || e.kind === 'COACH'),
      entries.some((e) => e.kind === 'CERT'),
      entries.some((e) => e.kind === 'AWARD'),
    ];
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  })();

  const photo = absolutizeUploadUrl(profile?.photoUrl ?? null);

  const MenuRow = ({ icon, label, count, badge, hint, onPress }: {
    icon: string; label: string; count?: number; badge?: number; hint?: string; onPress: () => void;
  }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.7 }]}>
      <View style={[styles.menuIcon, { backgroundColor: colors.background }]}>
        <Ionicons name={icon as never} size={17} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.menuLabel, { color: colors.text }]}>{label}</Text>
        {!!hint && <Text style={[styles.menuHint, { color: colors.textLight }]}>{hint}</Text>}
      </View>
      {count != null && count > 0 && <Text style={[styles.menuCount, { color: colors.textSecondary }]}>{count}</Text>}
      {!!badge && badge > 0 && (
        <View style={[styles.menuBadge, { backgroundColor: colors.danger }]}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>MY 코치</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}>
          {/* 프로필 카드 */}
          {profile ? (
            <Pressable
              onPress={() => router.push(`/coach/${profile.id}` as never)}
              style={({ pressed }) => [styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
            >
              {photo ? (
                <Image source={{ uri: photo }} style={styles.profilePhoto} />
              ) : (
                <View style={[styles.profilePhoto, { backgroundColor: colors.primary + '10', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>{profile.displayName.slice(0, 1)}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.profileNameRow}>
                  <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>{profile.displayName}</Text>
                  {!!profile.skillLevel && (
                    <View style={[styles.skillBadge, { backgroundColor: getSkillMeta(profile.skillLevel).color }]}>
                      <Text style={styles.skillBadgeText}>{profile.skillLevel}</Text>
                    </View>
                  )}
                  {profile.certified && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
                </View>
                <Text style={[styles.profileMeta, { color: colors.textLight }]} numberOfLines={1}>
                  {profile.active ? '코치 찾기에 공개 중' : '비공개 상태'} · 내 프로필 보기
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.completionPct, { color: completion >= 80 ? colors.secondary : colors.primary }]}>{completion}%</Text>
                <Text style={[styles.completionLabel, { color: colors.textLight }]}>프로필 완성도</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/coach/resume' as never)}
              style={({ pressed }) => [styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
            >
              <View style={[styles.profilePhoto, { backgroundColor: colors.primary + '10', alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person-add-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileName, { color: colors.text }]}>코치로 활동 시작하기</Text>
                <Text style={[styles.profileMeta, { color: colors.textLight }]}>프로필 하나 만들면 공고 지원까지 바로 열려요</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
            </Pressable>
          )}

          {/* 구직 활동 (코치 프로필이 있을 때만) */}
          {profile && (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
              <Text style={[styles.sectionTitle, { color: colors.textLight }]}>구직 활동</Text>
              <MenuRow icon="paper-plane-outline" label="지원 현황" count={myAppCount} hint="지원한 공고의 단계(지원→면접→합격)를 추적해요" onPress={() => router.push('/market/applications' as never)} />
              <MenuRow icon="mail-open-outline" label="받은 제안" badge={inviteCount} hint="공고 측이 내 프로필을 보고 보낸 스카웃" onPress={() => router.push('/market/invites' as never)} />
              <MenuRow icon="document-text-outline" label="코치 프로필" hint="사진·소개부터 경력·자격증·입상까지 한 문서로 관리해요" onPress={() => router.push('/coach/resume' as never)} />
              <MenuRow icon="school-outline" label="내 레슨 (수강생·출석)" onPress={() => router.push('/coach/lessons' as never)} />
              <MenuRow icon="cash-outline" label="정산 예정" hint="이번 달 레슨비 − 플랫폼 수수료 = 지급 예정액" onPress={() => router.push('/coach/settlement' as never)} />
            </View>
          )}

          {/* 채용 활동 (공고 올린 사람) */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <Text style={[styles.sectionTitle, { color: colors.textLight }]}>채용 활동</Text>
            <MenuRow icon="megaphone-outline" label="채용 관리 (내 공고)" count={myJobCount} badge={newApplicants} hint="공고별 지원자를 단계 탭으로 관리해요" onPress={() => router.push('/market/my-jobs' as never)} />
            <MenuRow icon="add-circle-outline" label="새 공고 올리기" hint="클럽 명의로도, 개인 요청으로도 올릴 수 있어요" onPress={() => router.push('/market/job/new' as never)} />
          </View>

          {/* 공통 */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <MenuRow icon="chatbubbles-outline" label="코치 채팅" badge={chatUnread} hint="레슨 문의와 채용 대화를 나눠서 보여드려요" onPress={() => router.push('/coach/inbox' as never)} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  profilePhoto: { width: 54, height: 54, borderRadius: 14 },
  profileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  profileName: { fontSize: 16.5, fontWeight: '800', flexShrink: 1 },
  profileMeta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  skillBadge: { minWidth: 20, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  skillBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  completionPct: { fontSize: 17, fontWeight: '900' },
  completionLabel: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  section: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sectionTitle: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  menuIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14.5, fontWeight: '700' },
  menuHint: { fontSize: 11.5, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  menuCount: { fontSize: 14, fontWeight: '800' },
  menuBadge: { minWidth: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  menuBadgeText: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
});

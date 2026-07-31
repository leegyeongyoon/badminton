import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, coachChatApi, type CoachDetail } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';
import { useAuthStore } from '../../store/authStore';

// ─────────────────────────────────────────────────────────────
// 코치 프로필 상세 — 사진·경력·가격·활동지역 + [채팅으로 레슨 문의].
// 운영진이 이 코치와 협의해 레슨을 열고, 회원은 레슨 카드에서 이 화면으로 온다.
// ─────────────────────────────────────────────────────────────

export default function CoachProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myUserId = useAuthStore((s) => s.user?.id);

  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!id) return;
    coachApi
      .get(id)
      .then(setCoach)
      .catch(() => {})
      .finally(() => setLoading(false));
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
  const careerLines = (coach.career || '').split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>{coach.displayName} 코치</Text>
        {isMe && (
          <Pressable onPress={() => router.push('/coach/edit' as never)} hitSlop={8}>
            <Text style={[styles.editLink, { color: colors.primary }]}>수정</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}>
        {/* 헤더: 사진 + 이름 + 인증 */}
        <View style={styles.header}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoFallback, { backgroundColor: colors.primary + '14' }]}>
              <Text style={[styles.photoInitial, { color: colors.primary }]}>{coach.displayName.slice(0, 1)}</Text>
            </View>
          )}
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text }]}>{coach.displayName}</Text>
            {coach.certified && (
              <View style={[styles.certBadge, { backgroundColor: colors.primary + '16' }]}>
                <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                <Text style={[styles.certText, { color: colors.primary }]}>인증 코치</Text>
              </View>
            )}
          </View>
          {!!coach.intro && <Text style={[styles.intro, { color: colors.textSecondary }]}>{coach.intro}</Text>}
          {!coach.active && (
            <Text style={[styles.inactive, { color: colors.textLight }]}>지금은 비공개 상태예요 (본인에게만 보임)</Text>
          )}
        </View>

        {/* 정보: 라벨-값 */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface }, shadows.md]}>
          {!!coach.regions && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>활동 지역</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.regions}</Text>
            </View>
          )}
          {coach.pricePerMonth != null && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>월 레슨비</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.pricePerMonth.toLocaleString()}원</Text>
            </View>
          )}
          {coach.pricePerSession != null && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>회당 레슨비</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.pricePerSession.toLocaleString()}원</Text>
            </View>
          )}
          {!!coach.availableTimes && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>가능 시간</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.availableTimes}</Text>
            </View>
          )}
          {coach.lessonCount > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textLight }]}>진행 레슨</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{coach.lessonCount}개</Text>
            </View>
          )}
        </View>

        {/* 경력 */}
        {careerLines.length > 0 && (
          <View style={[styles.infoCard, { backgroundColor: colors.surface }, shadows.md]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>경력 · 이력</Text>
            {careerLines.map((line, i) => (
              <View key={i} style={styles.careerRow}>
                <View style={[styles.careerDot, { backgroundColor: colors.textLight }]} />
                <Text style={[styles.careerText, { color: colors.textSecondary }]}>{line}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 운영자 안내 */}
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
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            onPress={startChat}
            disabled={starting}
            style={({ pressed }) => [styles.chatBtn, { backgroundColor: colors.primary }, (pressed || starting) && { opacity: 0.85 }]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  topBarFloating: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  topTitle: { ...typography.subtitle1, flex: 1 },
  editLink: { fontSize: 14, fontWeight: '800' },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  photo: { width: 116, height: 116, borderRadius: 58, marginBottom: spacing.md },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoInitial: { fontSize: 42, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  certBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  certText: { fontSize: 11, fontWeight: '800' },
  intro: { ...typography.body2, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },
  inactive: { fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
  infoCard: { borderRadius: 18, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.smd },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  infoLabel: { fontSize: 13, fontWeight: '700', width: 76 },
  infoValue: { fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  careerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  careerDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  careerText: { fontSize: 13.5, fontWeight: '600', flex: 1, lineHeight: 20 },
  howCard: { borderWidth: 1, borderRadius: 18, padding: spacing.lg, marginTop: spacing.xs },
  howTitle: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  howText: { fontSize: 13, fontWeight: '600', lineHeight: 21 },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  chatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 15, borderRadius: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  chatText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});

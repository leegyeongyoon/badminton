import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, SafeAreaView,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { Icon } from '../../../components/ui/Icon';
import { clubApi } from '../../../services/club';
import { typography, spacing, radius } from '../../../constants/theme';

// ─────────────────────────────────────────────────────────
// 모임 참여 QR — 멤버가 띄워두면 친구가 스캔해 모임에 참여.
//  • GET /clubs/:id/invite-qr → { inviteCode, joinUrl, qr: data URL }
//  • 큰 QR <Image>(data URL) + 초대코드 텍스트(수동 입력 폴백) + 안내문구
//  • 스캔 → 웹 /join?code=... → 로그인 → 프로필설정 → 자동가입 → 입장
// ─────────────────────────────────────────────────────────

export default function ClubInviteQrScreen() {
  const router = useRouter();
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();

  const [qr, setQr] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await clubApi.getInviteQr(clubId);
      setQr(data?.qr ?? null);
      setInviteCode(data?.inviteCode ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'QR을 불러오지 못했어요');
      setQr(null);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={goBack} hitSlop={10} style={styles.headerBack} accessibilityLabel="뒤로">
        <Icon name="back" size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>모임 참여 QR</Text>
      <View style={styles.headerBack} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error || !qr ? (
        <View style={styles.center}>
          <Icon name="info" size={36} color={colors.textLight} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {error || 'QR 정보가 없어요'}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={load}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          {/* 큰 흰 카드 + 중앙 QR (data URL은 웹/네이티브 모두 렌더). */}
          <View style={[styles.qrCard, { backgroundColor: colors.surface }, shadows.lg]}>
            <Image
              source={{ uri: qr }}
              style={styles.qrImage}
              resizeMode="contain"
              accessibilityLabel="모임 참여 QR 코드"
            />
          </View>

          <Text style={[styles.caption, { color: colors.text }]}>
            이 QR을 스캔하면 모임에 참여해요
          </Text>

          {/* 수동 입력 폴백: 초대 코드 텍스트 */}
          {inviteCode && (
            <View style={[styles.codeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.codeLabel, { color: colors.textSecondary }]}>초대 코드</Text>
              <Text style={[styles.codeValue, { color: colors.text }]}>{inviteCode}</Text>
            </View>
          )}

          <Text style={[styles.subCaption, { color: colors.textSecondary }]}>
            QR을 못 쓰면 위 초대 코드를 직접 입력해도 참여할 수 있어요
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const QR_SIZE = 280;

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerBack: { padding: spacing.xs, minWidth: 30 },
  headerTitle: { ...typography.subtitle1 },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md,
    padding: spacing.xl,
  },
  errorText: { ...typography.subtitle2, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  retryBtnText: { ...typography.subtitle2, color: '#fff' },

  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.lg, padding: spacing.xl,
  },
  qrCard: {
    padding: spacing.xl,
    borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  qrImage: {
    width: QR_SIZE, height: QR_SIZE,
  },
  caption: {
    ...typography.h3, textAlign: 'center',
  },
  codeBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  codeLabel: {
    ...typography.caption,
  },
  codeValue: {
    ...typography.h2,
    letterSpacing: 4,
    fontWeight: '800',
    marginTop: 2,
  },
  subCaption: {
    ...typography.body2, textAlign: 'center', maxWidth: 360,
  },
});

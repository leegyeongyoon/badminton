import { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { usePendingJoinStore } from '../store/pendingJoinStore';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing } from '../constants/theme';

// ─────────────────────────────────────────────────────────
// 모임 참여 진입점 (/join?code=<inviteCode>).
//  • QR(폰 카메라)을 스캔하면 웹앱이 여기로 열림.
//  • code 를 pendingInviteCode 로 저장(스토리지 영속 → 로그인/프로필설정/리로드 생존).
//  • 미인증이면 로그인으로 보냄(코드는 대기 상태로 유지).
//  • 인증 + 프로필 완료 상태면 루트 게이트가 자동 가입 후 모임으로 입장시킴.
// ─────────────────────────────────────────────────────────

export default function JoinScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { isAuthenticated } = useAuthStore();
  const { setPendingInviteCode } = usePendingJoinStore();
  const { colors } = useTheme();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const run = async () => {
      const trimmed = typeof code === 'string' ? code.trim() : '';
      if (!trimmed) {
        // No code → nothing to join; send the user home/login via the gate.
        router.replace('/');
        return;
      }

      // Persist the pending invite code so it survives login + profile-setup.
      await setPendingInviteCode(trimmed);

      // If not authenticated, send them to login. The code stays pending and the
      // gate will consume it once they're authenticated with a complete profile.
      if (!isAuthenticated) {
        router.replace('/(auth)/login');
      }
      // If already authenticated, do nothing here — the root layout gate picks up
      // the pendingInviteCode and performs the join + navigation.
    };

    run();
  }, [code, isAuthenticated]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>모임에 참여하는 중…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  text: {
    ...typography.subtitle2,
  },
});

import { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { usePendingAttendStore } from '../store/pendingAttendStore';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing } from '../constants/theme';

// ─────────────────────────────────────────────────────────
// 정모 출석 진입점 (/attend?session=<clubSessionId>).
//  • 출석 QR(폰 카메라)을 스캔하면 웹앱이 여기로 열림.
//  • session 을 pendingAttendSessionId 로 저장(스토리지 영속 → 로그인/프로필설정/리로드 생존).
//  • 미인증이면 로그인으로 보냄(세션 id는 대기 상태로 유지).
//  • 인증 + 프로필 완료 상태면 루트 게이트가 무조건 출석(지오펜스 없음) 후 현황 보드로 입장시킴.
//  • 거울짝: app/join.tsx (모임 참여 진입점).
// ─────────────────────────────────────────────────────────

export default function AttendScreen() {
  const router = useRouter();
  const { session } = useLocalSearchParams<{ session?: string }>();
  const { isAuthenticated } = useAuthStore();
  const { setPendingAttendSessionId } = usePendingAttendStore();
  const { colors } = useTheme();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const run = async () => {
      const trimmed = typeof session === 'string' ? session.trim() : '';
      if (!trimmed) {
        // No session id → nothing to attend; send the user home/login via the gate.
        router.replace('/');
        return;
      }

      // Persist the pending 정모 id so it survives login + profile-setup.
      await setPendingAttendSessionId(trimmed);

      // If not authenticated, send them to login. The id stays pending and the
      // gate will consume it once they're authenticated with a complete profile.
      if (!isAuthenticated) {
        router.replace('/(auth)/login');
      }
      // If already authenticated, do nothing here — the root layout gate picks up
      // the pendingAttendSessionId and performs the check-in + navigation.
    };

    run();
  }, [session, isAuthenticated]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>참석 처리 중…</Text>
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

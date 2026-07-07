import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { operatorRequestApi } from '../services/operatorRequest';
import type { OperatorRequestResponse } from '@badminton/shared';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { ScreenContainer } from '../components/ui/ScreenContainer';

/**
 * 운영자 회원가입 승인 대기 화면.
 *
 * 운영자 회원가입한 계정(accountStatus=PENDING)은 루트 게이트에 의해 이 화면으로 온다.
 * 신청한 모임 이름/지역과 상태(대기 중·거절됨)를 보여주고, 새로고침으로 승인 여부를
 * 다시 확인한다(승인되면 accountStatus=ACTIVE 가 되어 루트 게이트가 자동으로 홈 이동).
 * 앱의 다른 화면은 승인 전까지 접근할 수 없다.
 */
export default function OperatorPendingScreen() {
  const { colors, shadows } = useTheme();
  const { user, loadUser, logout } = useAuthStore();
  const [request, setRequest] = useState<OperatorRequestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rejected = user?.accountStatus === 'REJECTED' || request?.status === 'REJECTED';

  const refresh = useCallback(async () => {
    try {
      // 최신 계정 상태(승인 시 accountStatus=ACTIVE → 루트 게이트가 홈으로 보냄).
      await loadUser();
      const { data } = await operatorRequestApi.me();
      setRequest(data?.request ?? null);
    } catch {
      /* 네트워크 오류는 무시하고 다음 새로고침/폴링에서 재시도 */
    }
  }, [loadUser]);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
    // 승인되면 자동으로 넘어가도록 15초마다 상태 폴링.
    pollRef.current = setInterval(refresh, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContainer maxWidth={520}>
        <View style={styles.content}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: rejected ? colors.dangerBg : colors.primaryBg },
            ]}
          >
            <Icon
              name={rejected ? 'warning' : 'waiting'}
              size={40}
              color={rejected ? colors.danger : colors.primary}
            />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {rejected ? '가입 신청이 거절되었습니다' : '승인 대기 중이에요'}
          </Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>
            {rejected
              ? '운영자 가입 신청이 반려되었어요. 문의가 필요하면 관리자에게 연락해 주세요.'
              : '운영자 가입 신청이 접수되었어요. 최고관리자 승인이 완료되면 자동으로 앱을 이용할 수 있어요.'}
          </Text>

          {/* 신청 내용 요약 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.textLight }]}>신청자</Text>
              <Text style={[styles.value, { color: colors.text }]}>{user?.name || '-'}</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.divider }]} />
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.textLight }]}>운영할 모임</Text>
              <Text style={[styles.value, { color: colors.text }]}>{request?.clubName || '-'}</Text>
            </View>
            {request?.region ? (
              <>
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.textLight }]}>활동 지역</Text>
                  <Text style={[styles.value, { color: colors.text }]}>{request.region}</Text>
                </View>
              </>
            ) : null}
            <View style={[styles.divider, { backgroundColor: colors.divider }]} />
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.textLight }]}>상태</Text>
              <View style={[styles.badge, { backgroundColor: rejected ? colors.danger : colors.primary }]}>
                <Text style={styles.badgeText}>{rejected ? '거절됨' : '승인 대기'}</Text>
              </View>
            </View>
          </View>

          {!rejected ? (
            <Button
              title={refreshing ? '확인 중…' : '승인 여부 새로고침'}
              onPress={onRefresh}
              loading={refreshing}
              disabled={refreshing}
              fullWidth
              style={styles.refreshBtn}
            />
          ) : null}

          <Button
            title="로그아웃"
            onPress={logout}
            variant="outline"
            fullWidth
            style={styles.logoutBtn}
          />
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: Platform.OS === 'web' ? 0 : spacing.xxxl,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  desc: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xxl,
  },
  card: {
    width: '100%',
    borderRadius: radius.card,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.body2 },
  value: { ...typography.subtitle2, flexShrink: 1, textAlign: 'right', marginLeft: spacing.md },
  divider: { height: StyleSheet.hairlineWidth },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill ?? 999,
  },
  badgeText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  refreshBtn: { marginBottom: spacing.md },
  logoutBtn: {},
});

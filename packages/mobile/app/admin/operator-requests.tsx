import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Button } from '../../components/ui/Button';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { operatorRequestApi } from '../../services/operatorRequest';
import type { OperatorRequestWithRequester } from '@badminton/shared';
import { typography, radius, spacing } from '../../constants/theme';

export default function OperatorRequestsScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const [requests, setRequests] = useState<OperatorRequestWithRequester[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // id of the request currently being reviewed (disables its buttons).
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await operatorRequestApi.list('pending');
      setRequests(data || []);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '신청 목록을 불러오지 못했습니다');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const review = async (id: string, decision: 'approve' | 'reject') => {
    setReviewingId(id);
    try {
      await operatorRequestApi.review(id, decision);
      // Pending 목록에서 빠지므로 즉시 제거 후 재조회로 정합성 유지.
      setRequests((prev) => prev.filter((r) => r.id !== id));
      showSuccess(decision === 'approve' ? '운영자로 승인했어요' : '신청을 거절했어요');
      await load();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '처리에 실패했습니다');
      await load();
    } finally {
      setReviewingId(null);
    }
  };

  const confirmReview = (item: OperatorRequestWithRequester, decision: 'approve' | 'reject') => {
    const label = decision === 'approve' ? '승인' : '거절';
    showConfirm(
      `운영자 신청 ${label}`,
      `${item.requester.name}님의 운영자 신청을 ${label}하시겠어요?`,
      () => review(item.id, decision),
      label,
    );
  };

  const formatDate = (s: string) => new Date(s).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const renderItem = ({ item }: { item: OperatorRequestWithRequester }) => (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.name, { color: colors.text }]}>{item.requester.name}</Text>
        <Text style={[styles.phone, { color: colors.textSecondary }]}>{item.requester.phone || '-'}</Text>
      </View>
      <Text style={[styles.meta, { color: colors.textLight }]}>신청일 {formatDate(item.createdAt)}</Text>
      {item.message ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{item.message}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          title="거절"
          onPress={() => confirmReview(item, 'reject')}
          variant="outline"
          size="md"
          disabled={reviewingId === item.id}
        />
        <Button
          title="승인"
          onPress={() => confirmReview(item, 'approve')}
          variant="primary"
          size="md"
          loading={reviewingId === item.id}
        />
      </View>
    </View>
  );

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Text style={[styles.backText, { color: colors.primary }]}>{'‹'} 뒤로</Text>
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>운영자 신청 관리</Text>
      <View style={{ width: 60 }} />
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}
      <ScreenContainer maxWidth={720}>
      <FlatList
        data={requests}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, requests.length === 0 && styles.listEmpty]}
        refreshControl={
          Platform.OS === 'web' ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          )
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>대기 중인 신청이 없어요</Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              새로운 운영자 신청이 들어오면 여기에 표시됩니다.
            </Text>
          </View>
        }
      />
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'web' ? spacing.lg : spacing.xxxl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 60 },
  backText: { ...typography.body1, fontWeight: '600' },
  headerTitle: { ...typography.subtitle1 },
  list: { padding: spacing.lg, gap: spacing.md },
  listEmpty: { flexGrow: 1 },
  card: {
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  name: { ...typography.subtitle1 },
  phone: { ...typography.caption },
  meta: { ...typography.caption },
  message: {
    ...typography.body2,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.subtitle1 },
  emptyDesc: { ...typography.body2, textAlign: 'center' },
});

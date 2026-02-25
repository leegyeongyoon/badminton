import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useFacilityStore } from '../../store/facilityStore';
import { useTheme } from '../../hooks/useTheme';
import { useScrollAnimation } from '../../hooks/useScrollAnimation';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { Icon } from '../../components/ui/Icon';
import { AnimatedPressable } from '../../components/ui/AnimatedPressable';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { palette } from '../../constants/theme';
import api from '../../services/api';
import { courtApi } from '../../services/court';
import { useAdminData } from '../../hooks/useAdminData';

import { AdminHeader } from '../../components/admin/AdminHeader';
import { QuickActionsBar } from '../../components/admin/QuickActionsBar';
import { SessionControl } from '../../components/admin/SessionControl';
import { CapacityOverview } from '../../components/admin/CapacityOverview';
import { CheckedInUsersList } from '../../components/admin/CheckedInUsersList';
import { TodayStatsGrid } from '../../components/admin/TodayStatsGrid';
import { RotationCard } from '../../components/admin/RotationCard';
import { CourtManagementList } from '../../components/admin/CourtManagementList';
import { WeeklyTrendsCard } from '../../components/admin/WeeklyTrendsCard';
import { PeakHoursCard } from '../../components/admin/PeakHoursCard';
import { AdminSkeleton } from '../../components/admin/AdminSkeleton';
import { Skeleton } from '../../components/ui/Skeleton';
import { useLazyScreen } from '../../hooks/useLazyScreen';

export default function AdminDashboard() {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const { status: checkinStatus, fetchStatus: fetchCheckinStatus, isLoading: checkinLoading } = useCheckinStore();
  const { selectedFacility, selectedFacilityLoaded } = useFacilityStore();
  const facilityId = checkinStatus?.facilityId || selectedFacility?.id;

  useEffect(() => {
    fetchCheckinStatus();
  }, []);

  const {
    session, courts, capacity, rotation, todayStats,
    checkedInUsers, weeklyTrends, peakHours,
    refreshing, onRefresh, loadData,
  } = useAdminData(facilityId);

  const [usersExpanded, setUsersExpanded] = useState(false);
  const { scrollHandler, headerStyle } = useScrollAnimation();
  const { isReady: chartsReady } = useLazyScreen(100);

  // Staggered fade-in animations for each section group
  const fadeHeader = useFadeIn(0);
  const fadeSession = useFadeIn(60);
  const fadeCapacity = useFadeIn(120);
  const fadeUsers = useFadeIn(180);
  const fadeStats = useFadeIn(240);
  const fadeCharts = useFadeIn(300);
  const fadeRotation = useFadeIn(360);
  const fadeCourts = useFadeIn(420);

  const handleOpenSession = () => {
    showConfirm(
      Strings.admin.sessionOpenConfirm,
      Strings.admin.sessionOpenConfirmDesc,
      async () => {
        try {
          await api.post(`/facilities/${facilityId}/sessions/open`, {});
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '운영 시작 실패');
        }
      },
      Strings.common.confirm,
    );
  };

  const handleCloseSession = async () => {
    if (!session) return;
    showConfirm(
      '운영 종료',
      '운영을 종료하면 모든 활성 순번이 취소됩니다. 계속하시겠습니까?',
      async () => {
        try {
          await api.post(`/sessions/${session.id}/close`);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '운영 종료 실패');
        }
      },
      '종료',
    );
  };

  const handleCourtStatus = async (courtId: string, status: string) => {
    try {
      await api.patch(`/courts/${courtId}/status`, { status });
      loadData();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '코트 상태 변경 실패');
    }
  };

  const handleGameTypeChange = (courtId: string, currentType: string) => {
    const newType = currentType === 'DOUBLES' ? 'LESSON' : 'DOUBLES';
    const newLabel = Strings.court.gameType[newType as keyof typeof Strings.court.gameType] || newType;
    showConfirm(
      '게임 유형 변경',
      `${newLabel}(으)로 변경하시겠습니까?`,
      async () => {
        try {
          await api.patch(`/courts/${courtId}`, { gameType: newType });
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '게임 유형 변경 실패');
        }
      },
      Strings.common.confirm,
    );
  };

  const handleForceComplete = (turnId: string) => {
    showConfirm(
      '강제 종료',
      '이 게임을 강제로 종료하시겠습니까?',
      async () => {
        try {
          await courtApi.completeTurn(turnId);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '강제 종료 실패');
        }
      },
      '종료',
    );
  };

  const handleForceCancel = (turnId: string) => {
    showConfirm(
      '강제 취소',
      '이 순번을 강제로 취소하시겠습니까?',
      async () => {
        try {
          await courtApi.cancelTurn(turnId);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '강제 취소 실패');
        }
      },
      '취소',
    );
  };

  if (!selectedFacilityLoaded || checkinLoading) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!facilityId) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <Icon name="facility" size={48} color={colors.textLight} />
        <Text style={[styles.emptyText, { color: colors.textSecondary, ...typography.body1 }]}>
          시설을 선택한 후 관리자 메뉴를 사용할 수 있습니다
        </Text>
        <AnimatedPressable
          onPress={() => router.push('/facility-select')}
          style={[styles.facilitySelectBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.facilitySelectBtnText, { color: palette.white }]}>시설 선택하기</Text>
        </AnimatedPressable>
      </View>
    );
  }

  // Show skeleton while admin data is loading for the first time
  if (capacity === null && todayStats === null && courts.length === 0) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxxl }}
      >
        <AdminSkeleton />
      </ScrollView>
    );
  }

  return (
    <Animated.ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxxl }}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      refreshControl={<AnimatedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header + Quick Actions */}
      <Animated.View style={[fadeHeader, headerStyle]}>
        <AdminHeader
          facilityName={checkinStatus?.facilityName || selectedFacility?.name}
          isLive={!!session}
        />
        <QuickActionsBar
          isSessionActive={!!session}
          onToggleSession={session ? handleCloseSession : handleOpenSession}
          onViewRotation={() => router.push('/admin/rotation')}
          onViewPenalties={() => router.push('/admin/penalties')}
        />
      </Animated.View>

      {/* Session Controls */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeSession]}>
        <SectionHeader title="운영 관리" />
        <SessionControl
          session={session}
          onOpen={handleOpenSession}
          onClose={handleCloseSession}
        />
      </Animated.View>

      {/* Capacity */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeCapacity]}>
        <SectionHeader title="수용 현황" />
        <CapacityOverview capacity={capacity} />
      </Animated.View>

      {/* Checked-In Users */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeUsers]}>
        <CheckedInUsersList
          users={checkedInUsers}
          expanded={usersExpanded}
          onToggle={() => setUsersExpanded(!usersExpanded)}
        />
      </Animated.View>

      {/* Today Stats */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeStats]}>
        <SectionHeader title="오늘의 통계" />
        <TodayStatsGrid stats={todayStats} />
      </Animated.View>

      {/* Charts */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeCharts]}>
        <SectionHeader title="차트 분석" />
        {chartsReady ? (
          <>
            <WeeklyTrendsCard data={weeklyTrends} style={{ marginBottom: spacing.lg }} />
            <PeakHoursCard
              data={peakHours.data}
              hours={peakHours.hours}
              days={peakHours.days}
              style={{ marginBottom: 0 }}
            />
          </>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <Skeleton width="100%" height={200} borderRadius={16} />
            <Skeleton width="100%" height={160} borderRadius={16} />
          </View>
        )}
      </Animated.View>

      {/* Rotation */}
      <Animated.View style={[{ marginBottom: spacing.xxl }, fadeRotation]}>
        <SectionHeader title="로테이션" />
        <RotationCard
          rotation={rotation}
          onViewDetail={() => router.push('/admin/rotation')}
          onGenerate={() => router.push('/admin/rotation')}
        />
      </Animated.View>

      {/* Court Management */}
      <Animated.View style={fadeCourts}>
        <CourtManagementList
          courts={courts}
          onCourtStatus={handleCourtStatus}
          onGameTypeChange={handleGameTypeChange}
          onForceComplete={handleForceComplete}
          onForceCancel={handleForceCancel}
        />
      </Animated.View>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyText: {
    textAlign: 'center',
  },
  facilitySelectBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  facilitySelectBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

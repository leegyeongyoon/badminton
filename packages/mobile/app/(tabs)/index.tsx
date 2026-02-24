import { useState, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFacilityStore } from '../../store/facilityStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useBoardData } from '../../hooks/useBoardData';
import { BannerStack } from '../../components/board/BannerStack';
import { MyStatusSection } from '../../components/board/MyStatusSection';
import { CapacityBar } from '../../components/shared/CapacityBar';
import { RecruitmentSection } from '../../components/board/RecruitmentSection';
import { CourtGrid } from '../../components/board/CourtGrid';
import { CourtBottomSheet } from '../../components/court/CourtBottomSheet';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showConfirm } from '../../utils/alert';
import { recruitmentApi } from '../../services/recruitment';

export default function BoardScreen() {
  const router = useRouter();
  const { boardData, selectedFacility, isLoading } = useFacilityStore();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();

  const facilityId = selectedFacility?.id;
  const isCheckedIn = !!checkinStatus;

  const {
    capacity,
    recruitments,
    rotation,
    activeClubSession,
    isAdmin,
    refreshBoard,
    loadRecruitments,
  } = useBoardData(facilityId);

  // Bottom sheet state for 2-tap court registration
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const handleCourtPress = useCallback((courtId: string) => {
    setSelectedCourtId(courtId);
    setSheetVisible(true);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSheetVisible(false);
    setSelectedCourtId(null);
  }, []);

  const handleTurnRegistered = useCallback(() => {
    refreshBoard();
  }, [refreshBoard]);

  const handleJoinRecruitment = useCallback((recruitmentId: string) => {
    showConfirm(
      Strings.recruitment.join,
      '이 모집에 참여하시겠습니까?',
      async () => {
        try {
          await recruitmentApi.join(recruitmentId);
          loadRecruitments();
        } catch { /* silent */ }
      },
      Strings.common.confirm,
    );
  }, [loadRecruitments]);

  const handleLeaveRecruitment = useCallback((recruitmentId: string) => {
    showConfirm(
      Strings.recruitment.leave,
      '모집에서 탈퇴하시겠습니까?',
      async () => {
        try {
          await recruitmentApi.leave(recruitmentId);
          loadRecruitments();
        } catch { /* silent */ }
      },
      Strings.recruitment.leave,
    );
  }, [loadRecruitments]);

  const onRefresh = useCallback(() => {
    refreshBoard();
  }, [refreshBoard]);

  const renderListHeader = () => (
    <View>
      {/* Banners: checkin / club session / rotation */}
      <BannerStack
        isCheckedIn={isCheckedIn}
        checkinFacilityName={checkinStatus?.facilityName}
        activeClubSession={activeClubSession}
        rotation={rotation}
        onCheckinPress={() => router.push('/(tabs)/checkin')}
        onClubSessionPress={activeClubSession ? () => router.push(`/club/${activeClubSession.clubId}/session`) : undefined}
        onRotationPress={() => router.push('/admin/rotation')}
      />

      {/* My status: game in progress / waiting / idle */}
      <MyStatusSection onCheckinPress={() => router.push('/(tabs)/checkin')} />

      {/* Capacity bar */}
      {capacity && <CapacityBar capacity={capacity} />}

      {/* Recruitment section (collapsible) */}
      {recruitments.length > 0 && (
        <RecruitmentSection
          recruitments={recruitments}
          userId={user?.id}
          isCheckedIn={isCheckedIn}
          onJoin={handleJoinRecruitment}
          onLeave={handleLeaveRecruitment}
          onRegister={(id) => router.push(`/court/${id}`)}
          onCreatePress={() => router.push('/recruitment/create')}
        />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <CourtGrid
        data={boardData}
        isLoading={isLoading}
        onRefresh={onRefresh}
        isCheckedIn={isCheckedIn}
        currentUserId={user?.id}
        onCourtPress={handleCourtPress}
        ListHeaderComponent={renderListHeader()}
      />

      {/* Floating recruitment button */}
      {isCheckedIn && recruitments.length === 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/recruitment/create')}
        >
          <Text style={styles.fabText}>+ {Strings.recruitment.create}</Text>
        </TouchableOpacity>
      )}

      {/* Admin FAB */}
      {isAdmin && (
        <TouchableOpacity
          style={styles.adminFab}
          onPress={() => router.push('/admin')}
          activeOpacity={0.8}
        >
          <Text style={styles.adminFabText}>{Strings.admin.title}</Text>
        </TouchableOpacity>
      )}

      {/* Court bottom sheet - 2-tap registration flow */}
      <CourtBottomSheet
        visible={sheetVisible}
        onClose={handleSheetClose}
        courtId={selectedCourtId}
        facilityId={facilityId}
        onTurnRegistered={handleTurnRegistered}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    backgroundColor: Colors.secondary,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  adminFab: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    backgroundColor: Colors.primary,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  adminFabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

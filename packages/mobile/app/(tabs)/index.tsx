import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFacilityStore } from '../../store/facilityStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useBoardData } from '../../hooks/useBoardData';
import { CourtGrid } from '../../components/board/CourtGrid';
import { CourtBottomSheet } from '../../components/court/CourtBottomSheet';
import { BoardSkeleton } from '../../components/board/BoardSkeleton';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../../components/ui/Icon';
import { spacing, radius, typography, palette } from '../../constants/theme';

export default function CourtsScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { boardData, selectedFacility, isLoading } = useFacilityStore();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();

  const facilityId = selectedFacility?.id;
  const isCheckedIn = !!checkinStatus;

  const { isAdmin, refreshBoard } = useBoardData(facilityId);

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

  const onRefresh = useCallback(() => {
    refreshBoard();
  }, [refreshBoard]);

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      {/* Checkin prompt - only if not checked in */}
      {!isCheckedIn && (
        <TouchableOpacity
          style={[styles.checkinBanner, { backgroundColor: colors.warningLight }]}
          onPress={() => router.push('/checkin-modal')}
          activeOpacity={0.7}
        >
          <Icon name="qr" size={16} color={colors.warning} />
          <Text style={[styles.checkinBannerText, { color: colors.warning }]}>
            {Strings.checkin.banner}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const showSkeleton = isLoading && (!boardData || boardData.length === 0);

  if (showSkeleton) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <BoardSkeleton />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CourtGrid
        data={boardData}
        isLoading={isLoading}
        onRefresh={onRefresh}
        isCheckedIn={isCheckedIn}
        currentUserId={user?.id}
        onCourtPress={handleCourtPress}
        ListHeaderComponent={renderListHeader()}
      />

      {/* Admin icon button - top right area */}
      {isAdmin && (
        <TouchableOpacity
          style={[styles.adminButton, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}
          onPress={() => router.push('/admin')}
          activeOpacity={0.7}
        >
          <Icon name="settings" size={18} color={colors.primary} />
        </TouchableOpacity>
      )}

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
  },
  listHeader: {
    paddingBottom: spacing.sm,
  },
  checkinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smd,
    borderRadius: radius.lg,
  },
  checkinBannerText: {
    ...typography.buttonSm,
  },
  adminButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
});

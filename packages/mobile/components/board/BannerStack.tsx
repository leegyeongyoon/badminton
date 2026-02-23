import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

interface BannerStackProps {
  isCheckedIn: boolean;
  checkinFacilityName?: string;
  activeClubSession?: { clubId: string; clubName: string } | null;
  rotation?: { currentRound: number; totalRounds: number } | null;
  onCheckinPress: () => void;
  onClubSessionPress?: () => void;
  onRotationPress?: () => void;
}

export function BannerStack({
  isCheckedIn,
  checkinFacilityName,
  activeClubSession,
  rotation,
  onCheckinPress,
  onClubSessionPress,
  onRotationPress,
}: BannerStackProps) {
  return (
    <View>
      {/* Checkin banner */}
      {isCheckedIn ? (
        <View style={styles.checkinBannerActive}>
          <View style={styles.bannerLeft}>
            <View style={styles.checkinDot} />
            <Text style={styles.checkinBannerText}>{checkinFacilityName}</Text>
          </View>
          <Text style={styles.checkinBadge}>{Strings.checkin.checkedIn}</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.checkinBannerInactive}
          onPress={onCheckinPress}
          activeOpacity={0.7}
        >
          <View style={styles.bannerLeft}>
            <Text style={styles.readOnlyIcon}>{'👁'}</Text>
            <View>
              <Text style={styles.inactiveTitle}>{Strings.checkin.readOnlyNotice}</Text>
              <Text style={styles.inactiveDesc}>{Strings.checkin.banner}</Text>
            </View>
          </View>
          <View style={styles.checkinActionBadge}>
            <Text style={styles.checkinActionText}>QR 체크인</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Club session banner */}
      {activeClubSession && (
        <TouchableOpacity
          style={styles.clubSessionBanner}
          onPress={onClubSessionPress}
          activeOpacity={0.7}
        >
          <View style={styles.bannerLeft}>
            <View style={[styles.checkinDot, { backgroundColor: '#7C3AED' }]} />
            <Text style={styles.clubSessionText}>
              {activeClubSession.clubName} 모임 진행중
            </Text>
          </View>
          <Text style={styles.clubSessionAction}>모임 관리</Text>
        </TouchableOpacity>
      )}

      {/* Rotation banner */}
      {rotation && (
        <TouchableOpacity
          style={styles.rotationBanner}
          onPress={onRotationPress}
          activeOpacity={0.7}
        >
          <Text style={styles.rotationText}>
            로테이션 진행중: 라운드 {rotation.currentRound}/{rotation.totalRounds}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  checkinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.secondary,
  },
  // Active checkin
  checkinBannerActive: {
    backgroundColor: Colors.secondaryLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.secondary + '30',
  },
  checkinBannerText: {
    color: Colors.secondary,
    fontWeight: '600',
    fontSize: 14,
  },
  checkinBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Inactive checkin
  checkinBannerInactive: {
    backgroundColor: Colors.warningLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.warning + '30',
  },
  readOnlyIcon: {
    fontSize: 18,
  },
  inactiveTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
  },
  inactiveDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  checkinActionBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  checkinActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  // Club session
  clubSessionBanner: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#7C3AED' + '30',
  },
  clubSessionText: {
    color: '#7C3AED',
    fontWeight: '600',
    fontSize: 14,
  },
  clubSessionAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Rotation
  rotationBanner: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rotationText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },
});

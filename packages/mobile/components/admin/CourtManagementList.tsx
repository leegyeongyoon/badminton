import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { alpha } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useTheme } from '../../hooks/useTheme';

export interface TurnPlayer {
  userId: string;
  user: { name: string };
}

export interface TurnInfo {
  id: string;
  status: string;
  position: number;
  players: TurnPlayer[];
}

export interface CourtInfo {
  id: string;
  name: string;
  status: string;
  gameType: string;
  turns: TurnInfo[];
}

interface CourtManagementListProps {
  courts: CourtInfo[];
  onCourtStatus: (courtId: string, status: string) => void;
  onGameTypeChange: (courtId: string, currentType: string) => void;
  onForceComplete: (turnId: string) => void;
  onForceCancel: (turnId: string) => void;
}

export function CourtManagementList({
  courts,
  onCourtStatus,
  onGameTypeChange,
  onForceComplete,
  onForceCancel,
}: CourtManagementListProps) {
  const { colors, shadows, typography, spacing, radius, opacity } = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {Strings.admin.courtManagement}
      </Text>
      {courts.map((court) => {
        const playingTurn = court.turns?.find((t) => t.status === 'PLAYING');
        const waitingTurns = court.turns?.filter((t) => t.status === 'WAITING') || [];
        const isInUse = court.status === 'IN_USE';
        const isMaintenance = court.status === 'MAINTENANCE';
        return (
          <View
            key={court.id}
            style={[styles.courtCard, { backgroundColor: colors.surface, ...shadows.md }]}
          >
            <View style={styles.courtHeader}>
              <View style={styles.courtTitleRow}>
                <View style={[styles.courtStatusIndicator, {
                  backgroundColor: isMaintenance ? colors.courtMaintenance
                    : isInUse ? colors.courtInGame
                    : colors.courtEmpty,
                }]} />
                <Text style={[styles.courtName, { color: colors.text }]}>{court.name}</Text>
              </View>
              <View style={styles.courtBadges}>
                <View style={[styles.courtStatusBadge, {
                  backgroundColor: isMaintenance ? colors.divider
                    : isInUse ? colors.dangerLight
                    : colors.secondaryLight,
                }]}>
                  <Text style={[styles.courtStatusBadgeText, {
                    color: isMaintenance ? colors.textLight
                      : isInUse ? colors.danger
                      : colors.secondary,
                  }]}>
                    {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
                  </Text>
                </View>
                <AnimatedPressable
                  style={[styles.gameTypeBtn, {
                    backgroundColor: court.gameType === 'DOUBLES' ? colors.primaryLight : colors.warningLight,
                  }]}
                  onPress={() => onGameTypeChange(court.id, court.gameType)}
                >
                  <Text style={[styles.gameTypeBtnText, {
                    color: court.gameType === 'DOUBLES' ? colors.primary : colors.warning,
                  }]}>
                    {Strings.court.gameType[court.gameType as keyof typeof Strings.court.gameType] || court.gameType}
                  </Text>
                </AnimatedPressable>
              </View>
            </View>
            <View style={styles.courtActionsRow}>
              {isMaintenance ? (
                <AnimatedPressable
                  style={[styles.courtActivateBtn, {
                    backgroundColor: colors.secondaryLight,
                    borderColor: alpha(colors.secondary, opacity.border),
                  }]}
                  onPress={() => onCourtStatus(court.id, 'EMPTY')}
                >
                  <Icon name="success" size={14} color={colors.secondary} />
                  <Text style={[styles.courtActivateBtnText, { color: colors.secondary }]}>활성화</Text>
                </AnimatedPressable>
              ) : (
                <AnimatedPressable
                  style={[styles.courtMaintenanceBtn, { backgroundColor: colors.divider }]}
                  onPress={() => onCourtStatus(court.id, 'MAINTENANCE')}
                >
                  <Icon name="maintenance" size={14} color={colors.textSecondary} />
                  <Text style={[styles.courtMaintenanceBtnText, { color: colors.textSecondary }]}>점검</Text>
                </AnimatedPressable>
              )}
            </View>
            {/* Active turn controls */}
            {playingTurn && (
              <View style={[styles.turnControl, { borderTopColor: colors.divider }]}>
                <View style={styles.turnInfoRow}>
                  <View style={[styles.turnStatusIndicator, { backgroundColor: colors.playerInTurn }]} />
                  <View style={styles.turnDetails}>
                    <Text style={[styles.turnLabel, { color: colors.textSecondary }]}>게임 중</Text>
                    <Text style={[styles.turnPlayers, { color: colors.text }]}>
                      {playingTurn.players.map((p) => p.user.name).join(', ')}
                    </Text>
                  </View>
                </View>
                <AnimatedPressable
                  hapticType="medium"
                  style={[styles.forceCompleteBtn, {
                    backgroundColor: colors.dangerLight,
                    borderColor: alpha(colors.danger, opacity.border),
                  }]}
                  onPress={() => onForceComplete(playingTurn.id)}
                >
                  <Text style={[styles.forceBtnText, { color: colors.danger }]}>강제 종료</Text>
                </AnimatedPressable>
              </View>
            )}
            {waitingTurns.map((turn) => (
              <View key={turn.id} style={[styles.turnControl, { borderTopColor: colors.divider }]}>
                <View style={styles.turnInfoRow}>
                  <View style={[styles.turnStatusIndicator, { backgroundColor: colors.playerAvailable }]} />
                  <View style={styles.turnDetails}>
                    <Text style={[styles.turnLabel, { color: colors.textSecondary }]}>대기 #{turn.position}</Text>
                    <Text style={[styles.turnPlayers, { color: colors.text }]}>
                      {turn.players.map((p) => p.user.name).join(', ')}
                    </Text>
                  </View>
                </View>
                <AnimatedPressable
                  hapticType="medium"
                  style={[styles.forceCancelBtn, { backgroundColor: colors.divider }]}
                  onPress={() => onForceCancel(turn.id)}
                >
                  <Text style={[styles.forceCancelBtnText, { color: colors.textSecondary }]}>취소</Text>
                </AnimatedPressable>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  courtCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  courtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  courtTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  courtStatusIndicator: {
    width: 4,
    height: 28,
    borderRadius: 2,
  },
  courtName: {
    fontSize: 17,
    fontWeight: '700',
  },
  courtBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  courtStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  courtStatusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  courtActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  courtActivateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  courtActivateBtnText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  courtMaintenanceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
  },
  courtMaintenanceBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  gameTypeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  gameTypeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  turnControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  turnInfoRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  turnStatusIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
  },
  turnDetails: {
    flex: 1,
  },
  turnLabel: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    marginBottom: 2,
  },
  turnPlayers: {
    fontSize: 13,
    fontWeight: '500',
  },
  forceCompleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginLeft: 8,
  },
  forceBtnText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  forceCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  forceCancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
});

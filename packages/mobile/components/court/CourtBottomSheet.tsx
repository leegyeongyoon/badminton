import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { BottomSheet } from '../shared/BottomSheet';
import { PlayerSelector } from '../shared/PlayerSelector';
import { PlayerAvatarRow } from '../shared/PlayerAvatarRow';
import { CountdownTimer } from '../shared/CountdownTimer';
import { ConeIcon } from '../ui/ConeIcon';
import { useTheme } from '../../hooks/useTheme';
import { useAuthStore } from '../../store/authStore';
import { Strings } from '../../constants/strings';
import { courtApi } from '../../services/court';
import api from '../../services/api';
import { showAlert } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { palette, typography, radius, spacing } from '../../constants/theme';

interface AvailablePlayer {
  userId: string;
  userName: string;
  skillLevel: string;
  gender: string | null;
  gamesPlayedToday: number;
  status: 'AVAILABLE' | 'IN_TURN' | 'RESTING';
}

interface TurnPlayer {
  id: string;
  userId: string;
  userName: string;
}

interface CourtTurn {
  id: string;
  courtId: string;
  position: number;
  status: string;
  gameType: string;
  createdById: string;
  createdByName: string;
  players: TurnPlayer[];
  game: any | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeLimitAt: string | null;
}

interface CourtDetail {
  court: {
    id: string;
    name: string;
    facilityId: string;
    status: string;
    gameType: string;
    playersRequired: number;
  };
  turns: CourtTurn[];
  maxTurns: number;
}

interface CourtBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  courtId: string | null;
  facilityId: string | undefined;
  onTurnRegistered?: () => void;
}

type Step = 1 | 2;

export function CourtBottomSheet({
  visible,
  onClose,
  courtId,
  facilityId,
  onTurnRegistered,
}: CourtBottomSheetProps) {
  const { colors } = useTheme();
  const currentUser = useAuthStore((s) => s.user);
  const [step, setStep] = useState<Step>(1);
  const [courtDetail, setCourtDetail] = useState<CourtDetail | null>(null);
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const courtStatusColors: Record<string, string> = {
    EMPTY: colors.courtEmpty,
    IN_USE: colors.courtInGame,
    MAINTENANCE: colors.courtMaintenance,
  };

  const court = courtDetail?.court;
  const turns = courtDetail?.turns || [];
  const maxTurns = courtDetail?.maxTurns || 3;
  const playersRequired = court?.playersRequired || 4;
  const playingTurn = turns.find((t) => t.status === 'PLAYING');
  const waitingTurns = turns.filter((t) => t.status === 'WAITING');
  const canRegister = turns.length < maxTurns && court?.status !== 'MAINTENANCE';

  const selectedPlayerDetails = useMemo(() => {
    return selectedPlayers
      .map((id) => availablePlayers.find((p) => p.userId === id))
      .filter(Boolean) as AvailablePlayer[];
  }, [selectedPlayers, availablePlayers]);

  const loadData = useCallback(async () => {
    if (!courtId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await courtApi.getTurns(courtId);
      setCourtDetail(data);

      const fId = facilityId || data?.court?.facilityId;
      if (fId) {
        try {
          const { data: playersData } = await api.get(`/facilities/${fId}/players`);
          setAvailablePlayers(playersData || []);
        } catch {
          setAvailablePlayers([]);
        }
      }
    } catch {
      setCourtDetail(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [courtId, facilityId]);

  useEffect(() => {
    if (visible && courtId) {
      setStep(1);
      setSelectedPlayers([]);
      setPlayerSearch('');
      loadData();
    }
  }, [visible, courtId, loadData]);

  const handleTogglePlayer = useCallback((userId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      if (prev.length >= playersRequired) return prev;
      return [...prev, userId];
    });
  }, [playersRequired]);

  const handleIncludeMe = useCallback(() => {
    if (!currentUser) return;
    setSelectedPlayers((prev) => {
      if (prev.includes(currentUser.id)) return prev;
      if (prev.length >= playersRequired) return prev;
      return [...prev, currentUser.id];
    });
  }, [currentUser, playersRequired]);

  const handleSubmit = useCallback(async () => {
    if (!courtId || selectedPlayers.length !== playersRequired) return;
    setSubmitting(true);
    try {
      await courtApi.registerTurn(courtId, selectedPlayers);
      setSelectedPlayers([]);
      setPlayerSearch('');
      setStep(1);
      onTurnRegistered?.();
      onClose();
      showSuccess('고깔이 놓아졌습니다');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '고깔 놓기에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }, [courtId, selectedPlayers, playersRequired, onTurnRegistered, onClose]);

  const handleClose = useCallback(() => {
    setStep(1);
    onClose();
  }, [onClose]);

  // ── Step Indicator (2 dots) ──────────────────────────────
  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {[1, 2].map((s) => (
        <View
          key={s}
          style={[
            styles.stepDot,
            { backgroundColor: s === step ? colors.primary : colors.border },
          ]}
        />
      ))}
    </View>
  );

  // ── Step 1: Court Overview + "고깔 놓기" button ──────────
  const renderStep1 = () => {
    const statusColor = courtStatusColors[court?.status || ''] || colors.textLight;
    const statusLabel =
      Strings.court.status[court?.status as keyof typeof Strings.court.status] || court?.status;

    return (
      <>
        {/* Court header */}
        <View style={[styles.courtHeader, { borderBottomColor: colors.divider }]}>
          <View style={styles.courtHeaderLeft}>
            <Text style={[styles.courtName, { color: colors.text }]}>{court?.name}</Text>
            <Text style={[styles.courtMetaText, { color: colors.textSecondary }]}>
              {turns.length}/{maxTurns} {Strings.turn.indicator}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusBadgeText}>{statusLabel}</Text>
          </View>
        </View>

        {/* Current game with cones */}
        {playingTurn && (
          <View style={[styles.currentGameSection, { backgroundColor: colors.background }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{Strings.turn.nowPlaying}</Text>
              <View style={[styles.playingBadge, { backgroundColor: colors.dangerLight }]}>
                <View style={[styles.playingDot, { backgroundColor: colors.danger }]} />
                <Text style={[styles.playingBadgeText, { color: colors.danger }]}>LIVE</Text>
              </View>
            </View>
            {playingTurn.timeLimitAt && (
              <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="large" />
            )}
            <View style={styles.conePlayerRow}>
              {playingTurn.players.map((p) => (
                <View key={p.id} style={styles.conePlayerItem}>
                  <ConeIcon size={18} filled color={colors.primary} />
                  <Text style={[styles.conePlayerName, { color: colors.text }]}>{p.userName}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Waiting queue with cones */}
        {waitingTurns.length > 0 && (
          <View style={styles.waitingSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {Strings.turn.waitingQueue} ({waitingTurns.length})
            </Text>
            {waitingTurns.map((turn, index) => (
              <View key={turn.id} style={[styles.waitingItem, { backgroundColor: colors.background }]}>
                <View style={[styles.waitingPosition, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.waitingPositionText, { color: colors.primary }]}>{index + 1}</Text>
                </View>
                <View style={styles.waitingCones}>
                  {turn.players.map((p) => (
                    <View key={p.id} style={styles.conePlayerSmall}>
                      <ConeIcon size={14} filled dimmed />
                      <Text style={[styles.conePlayerSmallName, { color: colors.textSecondary }]}>
                        {p.userName}
                      </Text>
                    </View>
                  ))}
                  {/* Empty slots */}
                  {Array.from({ length: Math.max(0, playersRequired - turn.players.length) }).map((_, i) => (
                    <View key={`empty-${i}`} style={styles.conePlayerSmall}>
                      <ConeIcon size={14} filled={false} />
                      <Text style={[styles.conePlayerSmallName, { color: colors.textLight }]}>__</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Empty state */}
        {turns.length === 0 && canRegister && (
          <View style={styles.emptyHint}>
            <ConeIcon size={32} filled={false} />
            <Text style={[styles.emptyHintText, { color: colors.textSecondary }]}>
              {Strings.turn.noTurn}
            </Text>
          </View>
        )}

        {/* Maintenance notice */}
        {court?.status === 'MAINTENANCE' && (
          <View style={[styles.maintenanceNotice, { backgroundColor: colors.divider }]}>
            <Text style={[styles.maintenanceText, { color: colors.textSecondary }]}>
              {Strings.court.status.MAINTENANCE} - 고깔을 놓을 수 없습니다
            </Text>
          </View>
        )}

        {/* Primary action: go to player selection */}
        {canRegister && (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={() => setStep(2)}
          >
            <ConeIcon size={18} filled color={palette.white} />
            <Text style={styles.primaryButtonText}>{Strings.turn.placeCone}</Text>
          </TouchableOpacity>
        )}
      </>
    );
  };

  // ── Step 2: Player Selection + Confirm bar ───────────────
  const renderStep2 = () => {
    const isReady = selectedPlayers.length === playersRequired;
    const isMeSelected = currentUser ? selectedPlayers.includes(currentUser.id) : false;

    return (
      <>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
          <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>{'<'} 이전</Text>
        </TouchableOpacity>

        <Text style={[styles.stepTitle, { color: colors.text }]}>{Strings.turn.selectPlayers}</Text>

        {/* "나 포함" quick button */}
        {currentUser && !isMeSelected && (
          <TouchableOpacity
            style={[styles.includeMeButton, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
            onPress={handleIncludeMe}
          >
            <Text style={[styles.includeMeText, { color: colors.primary }]}>+ 나 포함</Text>
          </TouchableOpacity>
        )}
        {currentUser && isMeSelected && (
          <View style={[styles.includeMeButton, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
            <Text style={[styles.includeMeText, { color: colors.primary }]}>나 포함됨</Text>
          </View>
        )}

        <PlayerSelector
          players={availablePlayers}
          selectedIds={selectedPlayers}
          onToggle={handleTogglePlayer}
          playersRequired={playersRequired}
          searchValue={playerSearch}
          onSearchChange={setPlayerSearch}
        />

        {/* Selected players summary */}
        {selectedPlayerDetails.length > 0 && (
          <View style={[styles.selectedSummary, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.selectedCones}>
              {selectedPlayerDetails.map((p) => (
                <View key={p.userId} style={styles.selectedConeItem}>
                  <ConeIcon size={16} filled color={colors.primary} />
                  <Text style={[styles.selectedConeName, { color: colors.text }]}>{p.userName}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Confirm button */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: colors.primary },
            !isReady && styles.primaryButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isReady || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={palette.white} />
          ) : (
            <>
              <ConeIcon size={16} filled color={palette.white} />
              <Text style={styles.primaryButtonText}>
                {Strings.turn.placeCone} ({selectedPlayers.length}/{playersRequired})
              </Text>
            </>
          )}
        </TouchableOpacity>
      </>
    );
  };

  const sheetTitle = step === 1
    ? (court?.name || Strings.turn.placeCone)
    : Strings.turn.selectPlayers;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={sheetTitle}
      maxHeight={90}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{Strings.common.loading}</Text>
        </View>
      ) : loadError ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>코트 정보를 불러올 수 없습니다</Text>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={loadData}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {renderStepIndicator()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          <View style={{ height: spacing.xl }} />
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stepIndicator: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: spacing.sm, marginBottom: spacing.mlg,
  },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.sm },
  backButtonText: { fontSize: 14, fontWeight: '500' },
  stepTitle: { ...typography.h3, marginBottom: spacing.lg },
  loadingContainer: { paddingVertical: 48, alignItems: 'center', gap: spacing.md },
  loadingText: { fontSize: 14 },
  errorContainer: { paddingVertical: 48, alignItems: 'center', gap: spacing.md },
  errorText: { fontSize: 14 },
  retryButton: { borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.smd },
  retryButtonText: { color: palette.white, fontSize: 14, fontWeight: '600' },
  courtHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: spacing.mlg, borderBottomWidth: 1, marginBottom: spacing.mlg,
  },
  courtHeaderLeft: { flex: 1 },
  courtName: { fontSize: 18, fontWeight: '700' },
  courtMetaText: { fontSize: 13, fontWeight: '500', marginTop: spacing.xs },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  statusBadgeText: { color: palette.white, fontSize: 13, fontWeight: '600' },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.smd,
  },
  sectionTitle: { ...typography.button, marginBottom: spacing.sm },
  currentGameSection: { borderRadius: radius.xxl, padding: spacing.mlg, marginBottom: spacing.mlg },
  playingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm,
  },
  playingDot: { width: 6, height: 6, borderRadius: 3 },
  playingBadgeText: { ...typography.overline },
  conePlayerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  conePlayerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  conePlayerName: { fontSize: 13, fontWeight: '500' },
  waitingSection: { marginBottom: spacing.mlg },
  waitingItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginBottom: spacing.sm,
  },
  waitingPosition: {
    width: 24, height: 24, borderRadius: radius.xl, justifyContent: 'center', alignItems: 'center',
  },
  waitingPositionText: { ...typography.caption, fontSize: 12, fontWeight: '700' },
  waitingCones: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  conePlayerSmall: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  conePlayerSmallName: { fontSize: 11 },
  emptyHint: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  emptyHintText: { fontSize: 14 },
  maintenanceNotice: { borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  maintenanceText: { fontSize: 14, fontWeight: '500' },
  includeMeButton: {
    alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginBottom: spacing.lg,
  },
  includeMeText: { ...typography.buttonSm },
  selectedSummary: {
    borderRadius: radius.card, borderWidth: 1, padding: spacing.md, marginTop: spacing.md,
  },
  selectedCones: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  selectedConeItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  selectedConeName: { fontSize: 13, fontWeight: '500' },
  primaryButton: {
    borderRadius: radius.xxl, paddingVertical: spacing.mlg, alignItems: 'center',
    marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { ...typography.subtitle1, color: palette.white },
});

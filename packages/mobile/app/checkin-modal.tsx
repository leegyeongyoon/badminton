import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence } from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCheckinStore } from '../store/checkinStore';
import { checkinApi, type ActiveClubSessionItem } from '../services/checkin';
import { useTheme } from '../hooks/useTheme';
import { palette, typography, spacing, radius, opacity } from '../constants/theme';
import { Icon } from '../components/ui/Icon';
import { haptics } from '../utils/haptics';
import { getCurrentPosition } from '../utils/geo';

// expo-camera is not available on web, so we conditionally import
let CameraView: any = null;
let useCameraPermissions: any = null;
if (Platform.OS !== 'web') {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
}

/** Geofence rejection detail shape returned by the server (HTTP 400). */
interface GeofenceDetails {
  distanceM: number;
  radiusM: number;
  facilityName: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'pickSession'; code: string; sessions: ActiveClubSessionItem[] }
  | { kind: 'locating' }
  | { kind: 'submitting' }
  | { kind: 'locationDenied' }
  | { kind: 'outOfRange'; details: GeofenceDetails }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export default function CheckinModalScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { clubSessionId } = useLocalSearchParams<{ clubSessionId?: string }>();
  const { status, checkIn, fetchStatus } = useCheckinStore();

  const [showManualInput, setShowManualInput] = useState(Platform.OS === 'web');
  const [manualCode, setManualCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Remember the last scanned/entered code so "다시 시도" can re-acquire GPS
  const [lastCode, setLastCode] = useState<string | null>(null);

  const busy =
    phase.kind === 'resolving' ||
    phase.kind === 'locating' ||
    phase.kind === 'submitting';

  // Success animation
  const successScale = useSharedValue(0);
  const successOpacity = useSharedValue(0);
  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successOpacity.value,
  }));

  useEffect(() => {
    fetchStatus();
  }, []);

  // If already checked in, just go back (don't show success)
  useEffect(() => {
    if (status) {
      router.back();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * GPS hard-gate + submit. Receives the resolved clubSessionId (the 정모 to
   * check into). The server geofence rejects out-of-range with HTTP 400 + details.
   */
  const submitCheckIn = useCallback(
    async (code: string, resolvedClubSessionId?: string) => {
      // 1. Acquire GPS — REQUIRED. Missing location blocks check-in.
      setPhase({ kind: 'locating' });
      const coords = await getCurrentPosition();
      if (!coords) {
        setPhase({ kind: 'locationDenied' });
        return;
      }

      // 2. Submit with coordinates (+ clubSessionId when provided).
      setPhase({ kind: 'submitting' });
      try {
        await checkIn(code, {
          clubSessionId: resolvedClubSessionId || undefined,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        haptics.success();
        setPhase({ kind: 'success' });
        successOpacity.value = withSpring(1);
        successScale.value = withSequence(
          withSpring(1.2, { damping: 10, stiffness: 200 }),
          withSpring(1, { damping: 15, stiffness: 150 }),
        );
        setTimeout(() => {
          router.back();
        }, 1500);
      } catch (err: any) {
        const details: GeofenceDetails | undefined = err?.response?.data?.details;
        if (details && typeof details.distanceM === 'number') {
          haptics.error?.();
          setPhase({ kind: 'outOfRange', details });
        } else {
          setPhase({
            kind: 'error',
            message:
              err?.response?.data?.error ||
              err?.response?.data?.message ||
              '체크인에 실패했습니다',
          });
        }
      }
    },
    [checkIn, router, successOpacity, successScale],
  );

  /**
   * Core flow. If a clubSessionId param is present, submit directly (existing
   * behavior). Otherwise resolve the ACTIVE 정모 for the code first: 1 →
   * auto-use, >1 → show a picker (avoids the "정모를 선택해주세요" failure), 0 →
   * facility-only check-in (let the server fall back).
   */
  const runCheckIn = useCallback(
    async (code: string) => {
      if (busy) return;
      setLastCode(code);

      // Explicit 정모 from the param → keep current behavior.
      if (clubSessionId) {
        await submitCheckIn(code, clubSessionId);
        return;
      }

      // No param → resolve which 정모 (if any) to disambiguate.
      setPhase({ kind: 'resolving' });
      let sessions: ActiveClubSessionItem[];
      try {
        const { data } = await checkinApi.getActiveSessions(code);
        sessions = data;
      } catch (err: any) {
        setPhase({
          kind: 'error',
          message:
            err?.response?.status === 404
              ? '시설을 찾을 수 없습니다. 코드를 확인해주세요.'
              : err?.response?.data?.error ||
                err?.response?.data?.message ||
                '정모 정보를 불러오지 못했습니다',
        });
        return;
      }

      if (sessions.length > 1) {
        // Ambiguous → let the member pick.
        setPhase({ kind: 'pickSession', code, sessions });
        return;
      }

      // 0 → facility-only fallback; 1 → use it automatically.
      await submitCheckIn(code, sessions[0]?.clubSessionId);
    },
    [busy, clubSessionId, submitCheckIn],
  );

  const handleManualSubmit = useCallback(() => {
    if (!manualCode.trim()) return;
    runCheckIn(manualCode.trim());
  }, [manualCode, runCheckIn]);

  const handlePickSession = useCallback(
    (code: string, sessionId: string) => {
      if (busy) return;
      submitCheckIn(code, sessionId);
    },
    [busy, submitCheckIn],
  );

  const retry = useCallback(() => {
    if (lastCode) {
      runCheckIn(lastCode);
    } else {
      setPhase({ kind: 'idle' });
    }
  }, [lastCode, runCheckIn]);

  // ─── Success state ───────────────────────────────────────────
  if (phase.kind === 'success') {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <Animated.View style={[styles.successContainer, successStyle]}>
          <View style={[styles.successCircle, { backgroundColor: colors.secondaryLight }]}>
            <Icon name="success" size={64} color={colors.secondary} />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>체크인 완료!</Text>
          <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
            운영자가 게임에 배정하면 알림이 와요.
          </Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Icon name="back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>체크인</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.content}>
        {/* ─── 정모 picker (facility hosts more than one active 정모) ─── */}
        {phase.kind === 'pickSession' ? (
          <View style={styles.pickerWrap}>
            <View style={[styles.infoCard, { backgroundColor: colors.primaryBg, borderColor: colors.primaryLight }]}>
              <Icon name="calendar" size={20} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                진행 중인 정모가 여러 개예요. 체크인할 정모를 선택해주세요.
              </Text>
            </View>
            <View style={styles.sessionList}>
              {phase.sessions.map((s) => (
                <TouchableOpacity
                  key={s.clubSessionId}
                  style={[
                    styles.sessionItem,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    shadows.sm,
                  ]}
                  activeOpacity={0.8}
                  disabled={busy}
                  onPress={() => handlePickSession(phase.code, s.clubSessionId)}
                >
                  <View style={[styles.sessionIconWrap, { backgroundColor: colors.primaryLight }]}>
                    <Icon name="people" size={22} color={colors.primary} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={[styles.sessionName, { color: colors.text }]} numberOfLines={1}>
                      {s.title || s.clubName}
                    </Text>
                    <Text style={[styles.sessionMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {s.title ? `${s.clubName} · ` : ''}
                      {s.facilityName}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={20} color={colors.textLight} />
                </TouchableOpacity>
              ))}
            </View>
            {busy && (
              <View style={styles.locatingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.locatingText, { color: colors.textSecondary }]}>
                  체크인을 진행하는 중이에요…
                </Text>
              </View>
            )}
          </View>
        ) : phase.kind === 'locationDenied' ? (
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, shadows.md]}>
            <View style={[styles.gateIconWrap, { backgroundColor: colors.warningLight }]}>
              <Icon name="map" size={36} color={colors.warning} />
            </View>
            <Text style={[styles.gateTitle, { color: colors.text }]}>
              체크인하려면 위치 권한이 필요해요
            </Text>
            <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>
              체육관에 도착했는지 확인하기 위해 위치 정보를 사용해요. 기기 설정에서 위치
              권한을 허용한 뒤 다시 시도해주세요.
            </Text>
            <TouchableOpacity
              style={[styles.gateButton, { backgroundColor: colors.primary }]}
              onPress={retry}
              activeOpacity={0.85}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.white} />
              ) : (
                <Text style={styles.gateButtonText}>권한 허용하고 다시 시도</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : phase.kind === 'outOfRange' ? (
          /* ─── Out of geofence range ─── */
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, shadows.md]}>
            <View style={[styles.gateIconWrap, { backgroundColor: colors.dangerLight }]}>
              <Icon name="map" size={36} color={colors.danger} />
            </View>
            <Text style={[styles.gateTitle, { color: colors.text }]}>아직 체육관에서 멀어요</Text>
            <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>
              {phase.details.facilityName
                ? `${phase.details.facilityName}에서 `
                : '체육관에서 '}
              약 {Math.round(phase.details.distanceM)}m 떨어져 있어요 (허용{' '}
              {Math.round(phase.details.radiusM)}m). 가까이 가서 다시 시도하세요.
            </Text>
            <TouchableOpacity
              style={[styles.gateButton, { backgroundColor: colors.primary }]}
              onPress={retry}
              activeOpacity={0.85}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.white} />
              ) : (
                <Text style={styles.gateButtonText}>다시 시도</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : phase.kind === 'error' ? (
          /* ─── Generic error ─── */
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, shadows.md]}>
            <View style={[styles.gateIconWrap, { backgroundColor: colors.dangerLight }]}>
              <Icon name="error" size={36} color={colors.danger} />
            </View>
            <Text style={[styles.gateTitle, { color: colors.text }]}>체크인에 실패했어요</Text>
            <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>{phase.message}</Text>
            <TouchableOpacity
              style={[styles.gateButton, { backgroundColor: colors.primary }]}
              onPress={retry}
              activeOpacity={0.85}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.white} />
              ) : (
                <Text style={styles.gateButtonText}>다시 시도</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Info card */}
            <View style={[styles.infoCard, { backgroundColor: colors.primaryBg, borderColor: colors.primaryLight }]}>
              <Icon name="map" size={20} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                체육관에 도착한 뒤 위치 확인을 거쳐 체크인해요
              </Text>
            </View>

            {/* Camera / Code input section */}
            {Platform.OS !== 'web' && !showManualInput ? (
              <NativeCameraSection
                onScanned={runCheckIn}
                scanning={busy}
                onManualCode={() => setShowManualInput(true)}
              />
            ) : (
              <View style={styles.manualSection}>
                {Platform.OS === 'web' && (
                  <View style={styles.webCheckinHeader}>
                    <Icon name="facility" size={40} color={colors.primary} />
                    <Text style={[styles.webCheckinTitle, { color: colors.text }]}>시설 코드로 체크인</Text>
                    <Text style={[styles.webCheckinDesc, { color: colors.textSecondary }]}>
                      체육관에 비치된 시설 코드를 입력해주세요
                    </Text>
                  </View>
                )}
                <View style={[styles.codeCard, { backgroundColor: colors.surface }, shadows.md]}>
                  <View style={[styles.codeIconWrap, { backgroundColor: colors.primaryLight }]}>
                    <Icon name="qr" size={32} color={colors.primary} />
                  </View>
                  <Text style={[styles.codeTitle, { color: colors.text }]}>시설 코드 입력</Text>
                  <Text style={[styles.codeDesc, { color: colors.textSecondary }]}>
                    시설에 표시된 QR 코드 값이나 체크인 코드를 입력하세요
                  </Text>
                  <TextInput
                    style={[styles.codeInput, {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    }, Platform.OS === 'web' && styles.codeInputWeb]}
                    placeholder="시설 코드를 입력하세요"
                    placeholderTextColor={colors.textLight}
                    value={manualCode}
                    onChangeText={setManualCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleManualSubmit}
                  />
                  <TouchableOpacity
                    style={[
                      styles.submitButton,
                      { backgroundColor: colors.primary },
                      !manualCode.trim() && styles.submitButtonDisabled,
                    ]}
                    onPress={handleManualSubmit}
                    disabled={!manualCode.trim() || busy}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={palette.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>체크인</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.switchModeButton}
                    onPress={() => setShowManualInput(false)}
                  >
                    <Icon name="camera" size={16} color={colors.primary} />
                    <Text style={[styles.switchModeText, { color: colors.primary }]}>QR 스캔으로 전환</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* While resolving the 정모 / locating GPS, show a small inline hint */}
            {(phase.kind === 'resolving' || phase.kind === 'locating') && (
              <View style={styles.locatingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.locatingText, { color: colors.textSecondary }]}>
                  {phase.kind === 'resolving'
                    ? '정모를 확인하는 중이에요…'
                    : '위치를 확인하는 중이에요…'}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function NativeCameraSection({
  onScanned,
  scanning,
  onManualCode,
}: {
  onScanned: (data: string) => void;
  scanning: boolean;
  onManualCode: () => void;
}) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions!();

  if (!permission) {
    return <View style={[styles.cameraPlaceholder, { backgroundColor: colors.surface2 }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionSection}>
        <View style={[styles.permissionCard, { backgroundColor: colors.surface }]}>
          <Icon name="camera" size={40} color={colors.textLight} />
          <Text style={[styles.permissionTitle, { color: colors.text }]}>카메라 접근 권한이 필요합니다</Text>
          <Text style={[styles.permissionDesc, { color: colors.textSecondary }]}>
            QR 코드를 스캔하려면 카메라 권한을 허용해주세요
          </Text>
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
          >
            <Text style={styles.permissionButtonText}>권한 허용</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.switchModeButton} onPress={onManualCode}>
          <Text style={[styles.switchModeText, { color: colors.primary }]}>코드로 체크인</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraSection}>
      <View style={[styles.cameraContainer, { borderColor: colors.border }]}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? undefined : ({ data }: { data: string }) => onScanned(data)}
        />
        <View style={styles.overlay}>
          <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
        </View>
      </View>
      <Text style={[styles.cameraInstruction, { color: colors.textSecondary }]}>
        QR코드를 스캔하여 체크인하세요
      </Text>
      <TouchableOpacity style={styles.switchModeButton} onPress={onManualCode}>
        <Text style={[styles.switchModeText, { color: colors.primary }]}>코드로 체크인</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxxxl + spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.subtitle1,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
  },
  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.xl,
  },
  infoText: {
    ...typography.body2,
    flex: 1,
  },
  // GPS / geofence gate cards
  gateCard: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  gateIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  gateTitle: {
    ...typography.h3,
    textAlign: 'center',
  },
  gateDesc: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 22,
  },
  gateButton: {
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.mlg,
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  gateButtonText: {
    color: palette.white,
    ...typography.button,
  },
  // Locating hint
  locatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  locatingText: {
    ...typography.body2,
  },
  // 정모 picker (when >1 active session at the facility)
  pickerWrap: {
    gap: spacing.lg,
  },
  sessionList: {
    gap: spacing.md,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  sessionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    ...typography.subtitle2,
    fontWeight: '700',
  },
  sessionMeta: {
    ...typography.caption,
  },
  // Success state
  successContainer: {
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  successTitle: {
    ...typography.h2,
    marginBottom: spacing.sm,
  },
  successSubtitle: {
    ...typography.body1,
    textAlign: 'center',
  },
  // Camera section
  cameraSection: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: radius.banner,
    overflow: 'hidden',
    borderWidth: 2,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 200,
    height: 200,
    borderWidth: 3,
    borderRadius: radius.xl,
  },
  cameraInstruction: {
    ...typography.body2,
    textAlign: 'center',
  },
  cameraPlaceholder: {
    width: 280,
    height: 280,
    borderRadius: radius.banner,
    alignSelf: 'center',
  },
  // Permission section
  permissionSection: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  permissionCard: {
    borderRadius: radius.card,
    padding: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  permissionTitle: {
    ...typography.subtitle1,
    textAlign: 'center',
  },
  permissionDesc: {
    ...typography.body2,
    textAlign: 'center',
  },
  permissionButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.mlg,
    marginTop: spacing.sm,
  },
  permissionButtonText: {
    color: palette.white,
    ...typography.button,
  },
  // Manual code input section
  manualSection: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  codeCard: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  codeIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  codeTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  codeDesc: {
    ...typography.body2,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  codeInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mlg,
    ...typography.body1,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  submitButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.mlg,
    width: '100%',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: opacity.disabled,
  },
  submitButtonText: {
    color: palette.white,
    ...typography.button,
  },
  // Web checkin header
  webCheckinHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  webCheckinTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  webCheckinDesc: {
    fontSize: 14,
    textAlign: 'center',
  },
  // Web code input (larger/more prominent)
  codeInputWeb: {
    fontSize: 18,
    paddingVertical: spacing.lg,
    letterSpacing: 2,
  },
  // Switch mode
  switchModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  switchModeText: {
    ...typography.button,
    textDecorationLine: 'underline',
  },
});

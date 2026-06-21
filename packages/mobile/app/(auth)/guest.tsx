import { useState, useCallback } from 'react';
import type { ActiveClubSessionItem } from '../../services/checkin';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { checkinApi } from '../../services/checkin';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius, opacity } from '../../constants/theme';
import { Icon } from '../../components/ui/Icon';
import { haptics } from '../../utils/haptics';
import { getCurrentPosition } from '../../utils/geo';
import { SKILL_LEVELS, getSkillMeta, type SkillLevel } from '../../constants/skill';

// expo-camera is not available on web, so we conditionally import (mirror checkin-modal)
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

/** Prefix for a per-정모 출석 QR payload: `MEETUP:<clubSessionId>`. */
const MEETUP_PREFIX = 'MEETUP:';

/**
 * If `code` is a per-정모 출석 QR (`MEETUP:<id>`), return the clubSessionId;
 * otherwise null (it's a plain facility QR / code → existing qrData path).
 */
function parseMeetupSessionId(code: string): string | null {
  if (!code.startsWith(MEETUP_PREFIX)) return null;
  const id = code.slice(MEETUP_PREFIX.length).trim();
  return id || null;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'pickSession'; code: string; sessions: ActiveClubSessionItem[] }
  | { kind: 'locating' }
  | { kind: 'submitting' }
  | { kind: 'locationDenied' }
  | { kind: 'outOfRange'; details: GeofenceDetails }
  | { kind: 'error'; message: string };

const DEFAULT_SKILL: SkillLevel = 'E';

export default function GuestCheckinScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { setGuestSession } = useAuthStore();

  const [name, setName] = useState('');
  const [skill, setSkill] = useState<SkillLevel>(DEFAULT_SKILL);
  const [showManualInput, setShowManualInput] = useState(Platform.OS === 'web');
  const [manualCode, setManualCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Remember the last scanned/entered code so "다시 시도" can re-acquire GPS.
  const [lastCode, setLastCode] = useState<string | null>(null);

  const busy =
    phase.kind === 'resolving' ||
    phase.kind === 'locating' ||
    phase.kind === 'submitting';
  const nameValid = name.trim().length > 0;

  /**
   * GPS hard-gate + submit. Receives the already-resolved clubSessionId (the
   * 정모 the guest is attending) and, for a facility QR, the raw `code` (qrData).
   * For a per-정모 MEETUP QR `code` is undefined — the server resolves the
   * facility/geofence from the clubSessionId. On success store the guest token.
   */
  const submitCheckIn = useCallback(
    async (code: string | undefined, clubSessionId: string) => {
      // 1. Acquire GPS — REQUIRED. Missing location blocks check-in (hard gate).
      setPhase({ kind: 'locating' });
      const coords = await getCurrentPosition();
      if (!coords) {
        setPhase({ kind: 'locationDenied' });
        return;
      }

      // 2. Submit the guest check-in with coordinates + the chosen 정모.
      setPhase({ kind: 'submitting' });
      try {
        const { data } = await checkinApi.guestCheckIn({
          ...(code ? { qrData: code } : {}),
          clubSessionId,
          name: name.trim(),
          skillLevel: skill,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        haptics.success();
        // Persist the guest token + session; api.ts will attach the token.
        await setGuestSession({ user: data.user, token: data.token });
        // Root layout gate routes guests to /guest-status, but push for
        // immediacy too (the gate is idempotent).
        router.replace('/guest-status');
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
    [name, skill, setGuestSession, router],
  );

  /**
   * Core flow: validate name → resolve which 정모 to attend, then GPS + submit.
   * Resolution: fetch ACTIVE 정모 for the facility code; 0 → friendly error,
   * exactly 1 → auto-use, more than 1 → render a picker for the guest to tap.
   */
  const runCheckIn = useCallback(
    async (code: string) => {
      if (busy) return;
      if (!nameValid) {
        setPhase({ kind: 'error', message: '이름을 입력해주세요' });
        return;
      }
      setLastCode(code);

      // Per-정모 출석 QR (`MEETUP:<id>`, scanned OR pasted) → attend that 정모
      // directly with NO qrData; the server resolves the facility/geofence.
      const meetupSessionId = parseMeetupSessionId(code);
      if (meetupSessionId) {
        await submitCheckIn(undefined, meetupSessionId);
        return;
      }

      // 1. Resolve the active 정모 for this facility code.
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
              ? '시설을 찾을 수 없어요. 코드를 확인해주세요.'
              : err?.response?.data?.error ||
                err?.response?.data?.message ||
                '정모 정보를 불러오지 못했어요',
        });
        return;
      }

      if (sessions.length === 0) {
        setPhase({
          kind: 'error',
          message: '진행 중인 정모가 없어요. 코드를 확인해주세요.',
        });
        return;
      }
      if (sessions.length > 1) {
        // Ambiguous → let the guest pick which 정모 they're attending.
        setPhase({ kind: 'pickSession', code, sessions });
        return;
      }

      // Exactly one active 정모 → use it automatically.
      await submitCheckIn(code, sessions[0].clubSessionId);
    },
    [busy, nameValid, submitCheckIn],
  );

  const handleManualSubmit = useCallback(() => {
    if (!manualCode.trim()) return;
    runCheckIn(manualCode.trim());
  }, [manualCode, runCheckIn]);

  // Guest tapped a 정모 in the picker → proceed with that session.
  const handlePickSession = useCallback(
    (code: string, clubSessionId: string) => {
      if (busy) return;
      submitCheckIn(code, clubSessionId);
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

  // ─── Gate / error states (full-screen card) ───────────────────
  const gateState =
    phase.kind === 'locationDenied' ||
    phase.kind === 'outOfRange' ||
    phase.kind === 'error';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Icon name="back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>게스트 출석</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {phase.kind === 'pickSession' ? (
          <View style={styles.pickerWrap}>
            <View style={styles.intro}>
              <View style={[styles.introIconWrap, { backgroundColor: colors.primaryBg }]}>
                <Icon name="calendar" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.introTitle, { color: colors.text }]}>어떤 정모에 출석하세요?</Text>
              <Text style={[styles.introDesc, { color: colors.textSecondary }]}>
                이 체육관에서 진행 중인 정모가 여러 개예요. 참여할 정모를 선택해주세요.
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
                  출석을 진행하는 중이에요…
                </Text>
              </View>
            )}
          </View>
        ) : gateState ? (
          phase.kind === 'locationDenied' ? (
            <View style={[styles.gateCard, { backgroundColor: colors.surface }, shadows.md]}>
              <View style={[styles.gateIconWrap, { backgroundColor: colors.warningLight }]}>
                <Icon name="map" size={36} color={colors.warning} />
              </View>
              <Text style={[styles.gateTitle, { color: colors.text }]}>
                출석하려면 위치 권한이 필요해요
              </Text>
              <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>
                체육관에 도착했는지 확인하기 위해 위치 정보를 사용해요. 위치 권한을 허용한 뒤
                다시 시도해주세요.
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
          ) : (
            <View style={[styles.gateCard, { backgroundColor: colors.surface }, shadows.md]}>
              <View style={[styles.gateIconWrap, { backgroundColor: colors.dangerLight }]}>
                <Icon name="error" size={36} color={colors.danger} />
              </View>
              <Text style={[styles.gateTitle, { color: colors.text }]}>출석에 실패했어요</Text>
              <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>
                {phase.kind === 'error' ? phase.message : ''}
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
          )
        ) : (
          <>
            {/* Intro */}
            <View style={styles.intro}>
              <View style={[styles.introIconWrap, { backgroundColor: colors.primaryBg }]}>
                <Icon name="person" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.introTitle, { color: colors.text }]}>오늘 모임에 출석해요</Text>
              <Text style={[styles.introDesc, { color: colors.textSecondary }]}>
                회원가입 없이 참여할 수 있어요. 아래 정보를 입력해주세요.
              </Text>
            </View>

            {/* Name input (required) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                이름 <Text style={{ color: colors.danger }}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="이름을 입력하세요"
                placeholderTextColor={colors.textLight}
                value={name}
                onChangeText={setName}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* 급수 picker (optional) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>급수 (선택)</Text>
              <View style={styles.skillRow}>
                {SKILL_LEVELS.map((lvl) => {
                  const meta = getSkillMeta(lvl);
                  const selected = skill === lvl;
                  return (
                    <TouchableOpacity
                      key={lvl}
                      style={[
                        styles.skillChip,
                        { borderColor: colors.border, backgroundColor: colors.surface },
                        selected && { borderColor: meta.color, backgroundColor: meta.color + '20' },
                      ]}
                      onPress={() => setSkill(lvl)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.skillChipLevel,
                          { color: selected ? meta.color : colors.text },
                        ]}
                      >
                        {lvl}
                      </Text>
                      <Text
                        style={[
                          styles.skillChipLabel,
                          { color: selected ? meta.color : colors.textLight },
                        ]}
                        numberOfLines={1}
                      >
                        {meta.description}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Session identification: QR (native) / code (web) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>시설 코드</Text>

              {Platform.OS !== 'web' && !showManualInput ? (
                <NativeCameraSection
                  onScanned={runCheckIn}
                  scanning={busy}
                  onManualCode={() => setShowManualInput(true)}
                />
              ) : (
                <View style={[styles.codeCard, { backgroundColor: colors.surface }, shadows.md]}>
                  <View style={[styles.codeIconWrap, { backgroundColor: colors.primaryLight }]}>
                    <Icon name="qr" size={28} color={colors.primary} />
                  </View>
                  <Text style={[styles.codeDesc, { color: colors.textSecondary }]}>
                    시설에 표시된 QR 코드 값이나 체크인 코드를 입력하세요
                  </Text>
                  <TextInput
                    style={[
                      styles.codeInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                      Platform.OS === 'web' && styles.codeInputWeb,
                    ]}
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
                      (!manualCode.trim() || !nameValid) && styles.submitButtonDisabled,
                    ]}
                    onPress={handleManualSubmit}
                    disabled={!manualCode.trim() || !nameValid || busy}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={palette.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>출석하기</Text>
                    )}
                  </TouchableOpacity>

                  {Platform.OS !== 'web' && (
                    <TouchableOpacity
                      style={styles.switchModeButton}
                      onPress={() => setShowManualInput(false)}
                    >
                      <Icon name="camera" size={16} color={colors.primary} />
                      <Text style={[styles.switchModeText, { color: colors.primary }]}>
                        QR 스캔으로 전환
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Location hint */}
            <View style={[styles.infoCard, { backgroundColor: colors.primaryBg, borderColor: colors.primaryLight }]}>
              <Icon name="map" size={18} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                출석 시 위치 확인을 거쳐요. 체육관에 도착한 뒤 진행해주세요.
              </Text>
            </View>

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
      </ScrollView>
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
          <Text style={[styles.switchModeText, { color: colors.primary }]}>코드로 출석</Text>
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
        QR코드를 스캔하여 출석하세요
      </Text>
      <TouchableOpacity style={styles.switchModeButton} onPress={onManualCode}>
        <Text style={[styles.switchModeText, { color: colors.primary }]}>코드로 출석</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
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
    padding: spacing.xl,
    gap: spacing.xl,
    paddingBottom: spacing.xxxxl,
  },
  // Intro
  intro: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  introIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  introTitle: {
    ...typography.h3,
    textAlign: 'center',
  },
  introDesc: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Fields
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.caption,
    fontWeight: '600',
  },
  nameInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mlg,
    ...typography.body1,
  },
  // Skill picker
  skillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  skillChip: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minWidth: 64,
  },
  skillChipLevel: {
    ...typography.subtitle2,
    fontWeight: '800',
  },
  skillChipLabel: {
    ...typography.caption,
    marginTop: 2,
  },
  // Code card
  codeCard: {
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    width: '100%',
    gap: spacing.md,
  },
  codeIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeDesc: {
    ...typography.body2,
    textAlign: 'center',
  },
  codeInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mlg,
    ...typography.body1,
    textAlign: 'center',
  },
  codeInputWeb: {
    fontSize: 18,
    paddingVertical: spacing.lg,
    letterSpacing: 2,
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
  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  infoText: {
    ...typography.body2,
    flex: 1,
  },
  // Locating hint
  locatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  locatingText: {
    ...typography.body2,
  },
  // 정모 picker (when >1 active session at the facility)
  pickerWrap: {
    gap: spacing.xl,
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
  // Gate cards
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
  // Camera section (native)
  cameraSection: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  cameraContainer: {
    width: 260,
    height: 260,
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
    width: 180,
    height: 180,
    borderWidth: 3,
    borderRadius: radius.xl,
  },
  cameraInstruction: {
    ...typography.body2,
    textAlign: 'center',
  },
  cameraPlaceholder: {
    width: 260,
    height: 260,
    borderRadius: radius.banner,
    alignSelf: 'center',
  },
  permissionSection: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  permissionCard: {
    borderRadius: radius.card,
    padding: spacing.xxl,
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

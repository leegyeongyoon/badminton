import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../store/checkinStore';
import { useTheme } from '../hooks/useTheme';
import { palette, typography, spacing, radius, opacity, fontFamily } from '../constants/theme';
import { Strings } from '../constants/strings';
import { Icon } from '../components/ui/Icon';
import { haptics } from '../utils/haptics';
import { showAlert } from '../utils/alert';

// expo-camera is not available on web, so we conditionally import
let CameraView: any = null;
let useCameraPermissions: any = null;
if (Platform.OS !== 'web') {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
}

export default function CheckinModalScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { status, checkIn, fetchStatus } = useCheckinStore();
  const [scanning, setScanning] = useState(false);
  const [showManualInput, setShowManualInput] = useState(Platform.OS === 'web');
  const [manualCode, setManualCode] = useState('');
  const [success, setSuccess] = useState(false);

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

  // If already checked in, show success and go back
  useEffect(() => {
    if (status && !success) {
      // Already checked in — just go back
      router.back();
    }
  }, []);

  const handleCheckIn = useCallback(async (data: string) => {
    if (scanning) return;
    setScanning(true);
    try {
      await checkIn(data);
      haptics.success();
      setSuccess(true);
      // Play success animation
      successOpacity.value = withSpring(1);
      successScale.value = withSequence(
        withSpring(1.2, { damping: 10, stiffness: 200 }),
        withSpring(1, { damping: 15, stiffness: 150 }),
      );
      // Auto-navigate back after animation
      setTimeout(() => {
        router.back();
      }, 1500);
    } catch (err: any) {
      showAlert('체크인 실패', err.response?.data?.error || err.response?.data?.message || '체크인에 실패했습니다');
    } finally {
      setScanning(false);
    }
  }, [scanning, checkIn, router]);

  const handleManualSubmit = useCallback(() => {
    if (!manualCode.trim()) return;
    handleCheckIn(manualCode.trim());
  }, [manualCode, handleCheckIn]);

  // Success state
  if (success) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
        <Animated.View style={[styles.successContainer, successStyle]}>
          <View style={[styles.successCircle, { backgroundColor: colors.secondaryLight }]}>
            <Icon name="success" size={64} color={colors.secondary} />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>체크인 완료!</Text>
          <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
            이제 코트를 탭해서 게임에 참여하세요
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
        {/* Info card */}
        <View style={[styles.infoCard, { backgroundColor: colors.primaryBg, borderColor: colors.primaryLight }]}>
          <Icon name="info" size={20} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            체크인하면 코트 순번 등록과 게임 참여가 가능합니다
          </Text>
        </View>

        {/* Camera / Code input section */}
        {Platform.OS !== 'web' && !showManualInput ? (
          <NativeCameraSection
            onScanned={handleCheckIn}
            scanning={scanning}
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
                disabled={!manualCode.trim() || scanning}
              >
                {scanning ? (
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

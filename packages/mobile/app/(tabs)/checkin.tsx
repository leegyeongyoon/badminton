import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import { useCheckinStore } from '../../store/checkinStore';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius, opacity } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

// expo-camera is not available on web, so we conditionally import
let CameraView: any = null;
let useCameraPermissions: any = null;
if (Platform.OS !== 'web') {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
}

function WebCheckIn({ onCheckIn }: { onCheckIn: (qrData: string) => void }) {
  const { colors, shadows } = useTheme();
  const [qrInput, setQrInput] = useState('');
  return (
    <View style={[styles.webCheckinCard, { backgroundColor: colors.surface }, shadows.md]}>
      <Text style={[styles.webCheckinTitle, { color: colors.text }]}>시설 코드 입력</Text>
      <Text style={[styles.webCheckinDesc, { color: colors.textSecondary }]}>
        웹에서는 QR 스캔 대신 시설 코드를 직접 입력하세요
      </Text>
      <TextInput
        style={[styles.webInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        placeholder="시설 QR 코드 값"
        placeholderTextColor={colors.textLight}
        value={qrInput}
        onChangeText={setQrInput}
      />
      <TouchableOpacity
        style={[styles.webCheckinButton, { backgroundColor: colors.primary }, !qrInput && styles.buttonDisabled]}
        onPress={() => qrInput && onCheckIn(qrInput)}
        disabled={!qrInput}
      >
        <Text style={styles.webCheckinButtonText}>{Strings.checkin.title}</Text>
      </TouchableOpacity>
    </View>
  );
}

function NativeCamera({ onScanned, scanning, onManualCode }: { onScanned: (data: string) => void; scanning: boolean; onManualCode: () => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions!();

  if (!permission) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.permissionCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.permissionText, { color: colors.text }]}>카메라 접근 권한이 필요합니다</Text>
          <TouchableOpacity style={[styles.permissionButton, { backgroundColor: colors.primary }]} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>권한 요청</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onManualCode}>
            <Text style={[styles.manualCodeLink, { color: colors.primary }]}>코드로 체크인</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? undefined : ({ data }: { data: string }) => onScanned(data)}
        />
        <View style={styles.overlay}>
          <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
        </View>
      </View>
      <Text style={[styles.instruction, { color: colors.textSecondary }]}>QR코드를 스캔하여 체크인하세요</Text>
      <TouchableOpacity onPress={onManualCode}>
        <Text style={[styles.manualCodeLink, { color: colors.primary }]}>코드로 체크인</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function CheckInScreen() {
  const { colors, shadows } = useTheme();
  const [scanning, setScanning] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const { status, isLoading, checkIn, checkOut, fetchStatus } = useCheckinStore();

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleCheckIn = async (data: string) => {
    if (scanning) return;
    setScanning(true);
    try {
      await checkIn(data);
      showAlert('체크인 완료', '체크인되었습니다!');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '체크인에 실패했습니다');
    } finally {
      setScanning(false);
    }
  };

  const handleManualCheckIn = async () => {
    if (!manualCode.trim()) return;
    setScanning(true);
    try {
      await checkIn(manualCode.trim());
      setShowManualInput(false);
      setManualCode('');
      showAlert('체크인 완료', '체크인되었습니다');
    } catch (err: any) {
      showAlert('체크인 실패', err.response?.data?.message || '체크인에 실패했습니다');
    } finally {
      setScanning(false);
    }
  };

  const handleCheckout = async () => {
    try {
      await checkOut();
      showAlert('체크아웃', '체크아웃되었습니다');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '체크아웃에 실패했습니다');
    }
  };

  const manualInputModal = (
    <Modal visible={showManualInput} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>코드로 체크인</Text>
          <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>시설에 표시된 체크인 코드를 입력하세요</Text>
          <TextInput
            style={[styles.codeInput, { borderColor: colors.border, color: colors.text }]}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="시설 코드를 입력하세요"
            placeholderTextColor={colors.textLight}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={() => { setShowManualInput(false); setManualCode(''); }}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.primary }, !manualCode.trim() && styles.submitButtonDisabled]}
              onPress={handleManualCheckIn}
              disabled={!manualCode.trim()}
            >
              <Text style={styles.submitButtonText}>체크인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (status) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.checkedInCard, { backgroundColor: colors.surface }, shadows.md]}>
          <Text style={styles.checkedInIcon}>&#10003;</Text>
          <Text style={[styles.checkedInTitle, { color: colors.text }]}>{Strings.checkin.checkedIn}</Text>
          <Text style={[styles.facilityName, { color: colors.primary }]}>{status.facilityName}</Text>
          <Text style={[styles.checkedInTime, { color: colors.textSecondary }]}>
            {new Date(status.checkedInAt).toLocaleTimeString('ko-KR')} 부터
          </Text>
          <TouchableOpacity style={[styles.checkoutButton, { backgroundColor: colors.danger }]} onPress={handleCheckout}>
            <Text style={styles.checkoutText}>{Strings.checkin.checkout}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <WebCheckIn onCheckIn={handleCheckIn} />
      </View>
    );
  }

  return (
    <>
      <NativeCamera onScanned={handleCheckIn} scanning={scanning} onManualCode={() => setShowManualInput(true)} />
      {manualInputModal}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraContainer: {
    width: 300,
    height: 300,
    borderRadius: radius.banner,
    overflow: 'hidden',
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
    borderWidth: 2,
    borderRadius: radius.xl,
  },
  instruction: {
    marginTop: spacing.xl,
    ...typography.body1,
  },
  checkedInCard: {
    borderRadius: radius.card,
    padding: spacing.xxxl,
    alignItems: 'center',
    marginHorizontal: spacing.xxl,
  },
  checkedInIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  checkedInTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  facilityName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  checkedInTime: {
    ...typography.body2,
    marginBottom: spacing.xxl,
  },
  checkoutButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.mlg,
  },
  checkoutText: {
    color: palette.white,
    ...typography.button,
  },
  permissionCard: {
    borderRadius: radius.card,
    padding: spacing.xxxl,
    alignItems: 'center',
    marginHorizontal: spacing.xxl,
  },
  permissionText: {
    ...typography.body1,
    marginBottom: spacing.lg,
  },
  permissionButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  permissionButtonText: {
    color: palette.white,
    ...typography.button,
  },
  webCheckinCard: {
    borderRadius: radius.card,
    padding: spacing.xxxl,
    alignItems: 'center',
    marginHorizontal: spacing.xxl,
    maxWidth: 400,
    width: '100%',
  },
  webCheckinTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  webCheckinDesc: {
    ...typography.body2,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  webInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mlg,
    ...typography.body1,
    marginBottom: spacing.lg,
  },
  webCheckinButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.mlg,
    width: '100%',
    alignItems: 'center',
  },
  webCheckinButtonText: {
    color: palette.white,
    ...typography.button,
  },
  buttonDisabled: {
    opacity: opacity.disabled,
  },
  manualCodeLink: {
    textDecorationLine: 'underline' as const,
    textAlign: 'center' as const,
    marginTop: spacing.lg,
    ...typography.button,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    padding: spacing.xxl,
  },
  modalContent: {
    borderRadius: radius.card,
    padding: spacing.xxl,
  },
  modalTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  modalDesc: {
    ...typography.body2,
    marginBottom: spacing.xl,
  },
  codeInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.mlg,
    ...typography.body1,
  },
  modalButtons: {
    flexDirection: 'row' as const,
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  cancelButton: {
    flex: 1,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center' as const,
  },
  cancelButtonText: {
    ...typography.button,
  },
  submitButton: {
    flex: 1,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    alignItems: 'center' as const,
  },
  submitButtonDisabled: {
    opacity: opacity.disabled,
  },
  submitButtonText: {
    color: palette.white,
    ...typography.button,
  },
});

import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import { useCheckinStore } from '../../store/checkinStore';
import { Colors } from '../../constants/colors';
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
  const [qrInput, setQrInput] = useState('');
  return (
    <View style={styles.webCheckinCard}>
      <Text style={styles.webCheckinTitle}>시설 코드 입력</Text>
      <Text style={styles.webCheckinDesc}>
        웹에서는 QR 스캔 대신 시설 코드를 직접 입력하세요
      </Text>
      <TextInput
        style={styles.webInput}
        placeholder="시설 QR 코드 값"
        value={qrInput}
        onChangeText={setQrInput}
      />
      <TouchableOpacity
        style={[styles.webCheckinButton, !qrInput && styles.buttonDisabled]}
        onPress={() => qrInput && onCheckIn(qrInput)}
        disabled={!qrInput}
      >
        <Text style={styles.webCheckinButtonText}>{Strings.checkin.title}</Text>
      </TouchableOpacity>
    </View>
  );
}

function NativeCamera({ onScanned, scanning, onManualCode }: { onScanned: (data: string) => void; scanning: boolean; onManualCode: () => void }) {
  const [permission, requestPermission] = useCameraPermissions!();

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionText}>카메라 접근 권한이 필요합니다</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>권한 요청</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onManualCode}>
            <Text style={styles.manualCodeLink}>코드로 체크인</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? undefined : ({ data }: { data: string }) => onScanned(data)}
        />
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
        </View>
      </View>
      <Text style={styles.instruction}>QR코드를 스캔하여 체크인하세요</Text>
      <TouchableOpacity onPress={onManualCode}>
        <Text style={styles.manualCodeLink}>코드로 체크인</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function CheckInScreen() {
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
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>코드로 체크인</Text>
          <Text style={styles.modalDesc}>시설에 표시된 체크인 코드를 입력하세요</Text>
          <TextInput
            style={styles.codeInput}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="시설 코드를 입력하세요"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => { setShowManualInput(false); setManualCode(''); }}
            >
              <Text style={styles.cancelButtonText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, !manualCode.trim() && styles.submitButtonDisabled]}
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
      <View style={styles.container}>
        <View style={styles.checkedInCard}>
          <Text style={styles.checkedInIcon}>✅</Text>
          <Text style={styles.checkedInTitle}>{Strings.checkin.checkedIn}</Text>
          <Text style={styles.facilityName}>{status.facilityName}</Text>
          <Text style={styles.checkedInTime}>
            {new Date(status.checkedInAt).toLocaleTimeString('ko-KR')} 부터
          </Text>
          <TouchableOpacity style={styles.checkoutButton} onPress={handleCheckout}>
            <Text style={styles.checkoutText}>{Strings.checkin.checkout}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
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
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraContainer: {
    width: 300,
    height: 300,
    borderRadius: 20,
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
    borderColor: Colors.primary,
    borderRadius: 12,
  },
  instruction: {
    marginTop: 20,
    fontSize: 16,
    color: Colors.textSecondary,
  },
  checkedInCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  checkedInIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  checkedInTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  facilityName: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  checkedInTime: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  checkoutButton: {
    backgroundColor: Colors.danger,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  checkoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginHorizontal: 24,
  },
  permissionText: {
    fontSize: 16,
    color: Colors.text,
    marginBottom: 16,
  },
  permissionButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  webCheckinCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginHorizontal: 24,
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  webCheckinTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  webCheckinDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  webInput: {
    width: '100%',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 16,
    color: Colors.text,
  },
  webCheckinButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  webCheckinButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  manualCodeLink: {
    color: Colors.primary,
    textDecorationLine: 'underline' as const,
    textAlign: 'center' as const,
    marginTop: 16,
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    padding: 24,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.text,
  },
  modalButtons: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  submitButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
});

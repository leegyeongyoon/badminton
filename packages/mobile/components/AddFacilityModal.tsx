/**
 * 장소(체육관) 추가 모달.
 * 운영자가 새 장소를 만든다. 이름만 필수이고 주소/좌표는 선택.
 * 좌표는 "📍 내 현재 위치로" 버튼으로 캡처한다 (web: navigator.geolocation,
 * native: expo-location). 권한 거부/미지원이면 좌표 없이도 저장된다.
 *
 * onCreated(facilityId) 로 생성된 장소 id 를 돌려준다.
 */
import { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Colors } from '../constants/colors';
import { facilityApi } from '../services/facility';
import { getCurrentPosition } from '../utils/geo';
import { showAlert } from '../utils/alert';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';

interface AddFacilityModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (facilityId: string, facilityName: string) => void;
}

export function AddFacilityModal({ visible, onClose, onCreated }: AddFacilityModalProps) {
  // 태블릿/데스크톱(>=768)에서는 바텀시트 대신 가운데 다이얼로그로.
  const { isTablet } = useResponsiveLayout();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setName('');
    setAddress('');
    setCoords(null);
    setLocating(false);
    setSaving(false);
  }, []);

  const handleClose = useCallback(() => {
    if (saving) return;
    reset();
    onClose();
  }, [saving, reset, onClose]);

  const handleUseLocation = useCallback(async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      if (pos) {
        setCoords(pos);
      } else {
        showAlert(
          '위치를 가져올 수 없어요',
          '위치 권한을 확인해 주세요. 좌표 없이도 장소를 추가할 수 있어요.',
        );
      }
    } finally {
      setLocating(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert('알림', '장소 이름을 입력해 주세요');
      return;
    }
    setSaving(true);
    try {
      const body: {
        name: string;
        address?: string;
        latitude?: number;
        longitude?: number;
      } = { name: trimmed };
      const addr = address.trim();
      if (addr) body.address = addr;
      if (coords) {
        body.latitude = coords.latitude;
        body.longitude = coords.longitude;
      }
      const { data } = await facilityApi.create(body);
      reset();
      onClose();
      onCreated(data.id, data.name);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '장소 추가에 실패했어요');
      setSaving(false);
    }
  }, [name, address, coords, onClose, onCreated, reset]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.overlay, isTablet && styles.overlayCentered]}>
        <View style={[styles.card, isTablet && styles.cardCentered]}>
          <View style={styles.header}>
            <Text style={styles.title}>장소 추가</Text>
            <TouchableOpacity onPress={handleClose} accessibilityLabel="닫기">
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>
            이름 <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="예: 행복체육관"
            placeholderTextColor={Colors.textLight}
            maxLength={50}
            accessibilityLabel="장소 이름"
          />

          <Text style={styles.label}>주소</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="선택 입력"
            placeholderTextColor={Colors.textLight}
            maxLength={200}
            accessibilityLabel="장소 주소"
          />

          <Text style={styles.label}>좌표 설정</Text>
          <TouchableOpacity
            style={styles.locBtn}
            onPress={handleUseLocation}
            disabled={locating}
            accessibilityLabel="내 현재 위치로 좌표 설정"
          >
            {locating ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.locBtnText}>📍 내 현재 위치로</Text>
            )}
          </TouchableOpacity>
          {coords ? (
            <Text style={styles.coordText}>
              위도 {coords.latitude.toFixed(5)}, 경도 {coords.longitude.toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.coordHint}>좌표는 선택이에요. 나중에 핀을 찍을 수도 있어요.</Text>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel="장소 저장"
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.saveBtnText}>저장</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  // Tablet/desktop: center the dialog instead of a full-width bottom strip.
  overlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'web' ? 24 : 36,
  },
  cardCentered: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 20,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  close: {
    fontSize: 22,
    color: Colors.textLight,
    padding: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
    marginTop: 12,
  },
  required: {
    color: Colors.danger,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  locBtn: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '14',
  },
  locBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
  coordText: {
    fontSize: 13,
    color: Colors.text,
    marginTop: 8,
    fontWeight: '600',
  },
  coordHint: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 8,
  },
  saveBtn: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textInverse,
  },
});

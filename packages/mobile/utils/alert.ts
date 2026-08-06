import { Alert, Platform } from 'react-native';
import { confirmEmitter } from '../components/ui/ConfirmDialog';

export function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

/**
 * Shows a themed confirmation dialog using ConfirmDialog.
 * Falls back to native Alert on web.
 */
export function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmText = '확인',
  cancelText = '취소',
  variant: 'default' | 'danger' = 'default',
) {
  if (Platform.OS === 'web') {
    const ok = window.confirm(message ? `${title}\n${message}` : title);
    if (ok) onConfirm();
  } else {
    confirmEmitter.emit({
      title,
      message,
      confirmLabel: confirmText,
      cancelLabel: cancelText,
      variant,
      onConfirm,
    });
  }
}

/**
 * 모달 '안에서' 띄우는 확인창.
 *
 * showConfirm 은 네이티브에서 커스텀 ConfirmDialog(RN Modal)를 쓰는데, 이미 열린 다른
 * RN Modal(예: 코트 관리) 위에 겹쳐 뜨면 iOS에서 뒤에 깔려 안 눌리거나 백그라운드 후
 * 터치가 먹통이 된다. 그래서 '모달 안'의 확인은 이걸 쓴다 — 네이티브는 OS 알림
 * (Alert.alert; 모달 위에 정상 표시), 웹은 window.confirm. 테마는 못 입혀도 안정성 우선.
 */
export function showModalConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmText = '확인',
  cancelText = '취소',
  variant: 'default' | 'danger' = 'default',
) {
  if (Platform.OS === 'web') {
    const ok = window.confirm(message ? `${title}\n${message}` : title);
    if (ok) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel' },
      { text: confirmText, style: variant === 'danger' ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }
}

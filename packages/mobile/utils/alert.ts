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

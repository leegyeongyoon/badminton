import { Alert, Platform } from 'react-native';
import { confirmEmitter } from '../components/ui/ConfirmDialog';

// 웹은 브라우저 기본 alert/confirm 대신 앱 안의 확인창(ConfirmDialog)을 쓴다 — 브라우저 창은 페이지 전체를
// 멈춰서(운영판 실시간 갱신·자동 편성·소켓까지 정지) 운영 중에 뜨면 운영이 멈췄다(2026-10-27 실운영).
export function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') {
    confirmEmitter.emit({ title, message, confirmLabel: '확인', alertOnly: true, onConfirm: () => {} });
  } else {
    Alert.alert(title, message);
  }
}

/**
 * Shows a themed confirmation dialog using ConfirmDialog.
 * 웹·네이티브 모두 앱 안의 확인창.
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
    confirmEmitter.emit({ title, message, confirmLabel: confirmText, cancelLabel: cancelText, variant, onConfirm });
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
 * (Alert.alert; 모달 위에 정상 표시), 웹은 앱 안 확인창. 테마는 못 입혀도 안정성 우선.
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
    // 웹은 모달 위에 겹쳐도 문제없음(나중에 연 창이 위) — 앱 안 확인창.
    confirmEmitter.emit({ title, message, confirmLabel: confirmText, cancelLabel: cancelText, variant, onConfirm });
  } else {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel' },
      { text: confirmText, style: variant === 'danger' ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }
}

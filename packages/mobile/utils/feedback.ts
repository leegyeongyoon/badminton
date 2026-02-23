import { showAlert } from './alert';

export function showSuccess(message: string) {
  showAlert('완료', message);
}

export function showError(message: string) {
  showAlert('오류', message);
}

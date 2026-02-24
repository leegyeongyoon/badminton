type ToastType = 'success' | 'error' | 'info';
type Listener = (message: string, type: ToastType) => void;

class ToastEmitter {
  private listeners: Listener[] = [];

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(message: string, type: ToastType) {
    this.listeners.forEach((fn) => fn(message, type));
  }
}

export const toastEmitter = new ToastEmitter();

export function showSuccess(message: string) {
  toastEmitter.emit(message, 'success');
}

export function showError(message: string) {
  toastEmitter.emit(message, 'error');
}

export function showInfo(message: string) {
  toastEmitter.emit(message, 'info');
}

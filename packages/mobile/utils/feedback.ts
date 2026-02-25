import type { IconName } from '../components/ui/Icon';

type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastPayload {
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration?: number;
  icon?: IconName;
}

type Listener = (payload: ToastPayload) => void;

class ToastEmitter {
  private listeners: Listener[] = [];

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(payload: ToastPayload) {
    this.listeners.forEach((fn) => fn(payload));
  }
}

export const toastEmitter = new ToastEmitter();

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  icon?: IconName;
}

export function showSuccess(message: string, options?: ToastOptions) {
  toastEmitter.emit({ message, type: 'success', ...options });
}

export function showError(message: string, options?: ToastOptions) {
  toastEmitter.emit({ message, type: 'error', ...options });
}

export function showInfo(message: string, options?: ToastOptions) {
  toastEmitter.emit({ message, type: 'info', ...options });
}

export function showWarning(message: string, options?: ToastOptions) {
  toastEmitter.emit({ message, type: 'warning', ...options });
}

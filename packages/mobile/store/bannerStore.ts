import { create } from 'zustand';

export interface BannerPayload {
  title: string;
  subtitle?: string;
  courtName?: string;
  /** Active 정모 id — lets the banner tap route straight to the live board. */
  clubSessionId?: string;
}

interface BannerState {
  visible: boolean;
  title: string;
  subtitle?: string;
  courtName?: string;
  clubSessionId?: string;
  show: (payload: BannerPayload) => void;
  hide: () => void;
}

/**
 * Drives the global "내 차례" TurnBanner overlay.
 * Raised from socket events (useSocketToast) and push handlers (useNotifications).
 */
export const useBannerStore = create<BannerState>((set) => ({
  visible: false,
  title: '',
  subtitle: undefined,
  courtName: undefined,
  clubSessionId: undefined,

  show: ({ title, subtitle, courtName, clubSessionId }) =>
    set({ visible: true, title, subtitle, courtName, clubSessionId }),

  hide: () => set({ visible: false }),
}));

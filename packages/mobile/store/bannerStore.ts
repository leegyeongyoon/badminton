import { create } from 'zustand';

export interface BannerPayload {
  title: string;
  subtitle?: string;
  courtName?: string;
}

interface BannerState {
  visible: boolean;
  title: string;
  subtitle?: string;
  courtName?: string;
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

  show: ({ title, subtitle, courtName }) =>
    set({ visible: true, title, subtitle, courtName }),

  hide: () => set({ visible: false }),
}));

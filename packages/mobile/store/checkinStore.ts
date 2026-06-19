import { create } from 'zustand';
import { checkinApi } from '../services/checkin';

interface CheckInStatus {
  id: string;
  userId: string;
  facilityId: string;
  /** Present on the POST /checkin response (per-정모 check-in). */
  clubSessionId?: string | null;
  facilityName: string;
  checkedInAt: string;
}

interface CheckInOptions {
  clubSessionId?: string;
  latitude: number;
  longitude: number;
}

interface CheckInState {
  status: CheckInStatus | null;
  isLoading: boolean;
  isResting: boolean;
  restingSince: string | null;
  checkIn: (qrData: string, opts: CheckInOptions) => Promise<void>;
  checkOut: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  toggleRest: () => Promise<void>;
  setRestState: (resting: boolean) => void;
}

export const useCheckinStore = create<CheckInState>((set, get) => ({
  status: null,
  isLoading: false,
  isResting: false,
  restingSince: null,

  checkIn: async (qrData, opts) => {
    // Let the caller (modal) read err.response.data.details on geofence
    // rejection — do NOT swallow the error here.
    const { data } = await checkinApi.checkIn(qrData, opts);
    set({ status: data });
  },

  checkOut: async () => {
    await checkinApi.checkOut();
    set({ status: null, isResting: false, restingSince: null });
  },

  fetchStatus: async () => {
    set({ isLoading: true });
    try {
      const { data } = await checkinApi.getStatus();
      set({ status: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  toggleRest: async () => {
    const { isResting } = get();
    if (isResting) {
      await checkinApi.setAvailable();
      set({ isResting: false, restingSince: null });
    } else {
      await checkinApi.setResting();
      set({ isResting: true, restingSince: new Date().toISOString() });
    }
  },

  setRestState: (resting: boolean) => {
    set({
      isResting: resting,
      restingSince: resting ? (get().restingSince ?? new Date().toISOString()) : null,
    });
  },
}));

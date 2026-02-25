import { create } from 'zustand';
import { checkinApi } from '../services/checkin';

interface CheckInStatus {
  id: string;
  userId: string;
  facilityId: string;
  facilityName: string;
  checkedInAt: string;
}

interface CheckInState {
  status: CheckInStatus | null;
  isLoading: boolean;
  isResting: boolean;
  restingSince: string | null;
  checkIn: (qrData: string) => Promise<void>;
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

  checkIn: async (qrData) => {
    const { data } = await checkinApi.checkIn(qrData);
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

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
  checkIn: (qrData: string) => Promise<void>;
  checkOut: () => Promise<void>;
  fetchStatus: () => Promise<void>;
}

export const useCheckinStore = create<CheckInState>((set) => ({
  status: null,
  isLoading: false,

  checkIn: async (qrData) => {
    const { data } = await checkinApi.checkIn(qrData);
    set({ status: data });
  },

  checkOut: async () => {
    await checkinApi.checkOut();
    set({ status: null });
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
}));

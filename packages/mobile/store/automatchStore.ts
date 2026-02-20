import { create } from 'zustand';
import { automatchApi } from '../services/automatch';

interface AutoMatchEntry {
  id: string;
  userId: string;
  userName: string;
  gameType: string;
  status: string;
  joinedAt: string;
}

interface AutoMatchState {
  entries: AutoMatchEntry[];
  totalWaiting: number;
  isLoading: boolean;
  isJoining: boolean;
  myEntry: AutoMatchEntry | null;

  fetchPool: (facilityId: string) => Promise<void>;
  joinPool: (facilityId: string, gameType: string) => Promise<void>;
  leavePool: (facilityId: string) => Promise<void>;
  updatePoolCount: (totalWaiting: number) => void;
}

export const useAutomatchStore = create<AutoMatchState>((set) => ({
  entries: [],
  totalWaiting: 0,
  isLoading: false,
  isJoining: false,
  myEntry: null,

  fetchPool: async (facilityId) => {
    set({ isLoading: true });
    try {
      const { data } = await automatchApi.getPool(facilityId);
      set({
        entries: data.entries,
        totalWaiting: data.totalWaiting,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  joinPool: async (facilityId, gameType) => {
    set({ isJoining: true });
    try {
      await automatchApi.joinPool(facilityId, gameType);
      // Refresh pool after joining
      const { data } = await automatchApi.getPool(facilityId);
      set({
        entries: data.entries,
        totalWaiting: data.totalWaiting,
        isJoining: false,
      });
    } catch {
      set({ isJoining: false });
      throw new Error('자동 매칭 참가에 실패했습니다');
    }
  },

  leavePool: async (facilityId) => {
    try {
      await automatchApi.leavePool(facilityId);
      set({ myEntry: null });
    } catch {
      throw new Error('자동 매칭 나가기에 실패했습니다');
    }
  },

  updatePoolCount: (totalWaiting) => {
    set({ totalWaiting });
  },
}));

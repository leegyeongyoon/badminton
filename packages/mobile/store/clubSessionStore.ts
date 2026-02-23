import { create } from 'zustand';
import { clubSessionApi } from '../services/clubSession';

interface ClubSession {
  id: string;
  clubId: string;
  clubName: string;
  facilityId: string;
  facilityName: string;
  facilitySessionId: string;
  startedById: string;
  startedByName: string;
  status: string;
  courtIds: string[];
  startedAt: string;
  endedAt: string | null;
}

interface ClubSessionState {
  activeSession: ClubSession | null;
  isLoading: boolean;
  fetchActiveSession: (clubId: string) => Promise<void>;
  startSession: (clubId: string, facilityId: string, courtIds?: string[]) => Promise<void>;
  endSession: (sessionId: string) => Promise<void>;
  clearSession: () => void;
}

export const useClubSessionStore = create<ClubSessionState>((set) => ({
  activeSession: null,
  isLoading: false,

  fetchActiveSession: async (clubId) => {
    set({ isLoading: true });
    try {
      const { data } = await clubSessionApi.getActive(clubId);
      set({ activeSession: data, isLoading: false });
    } catch {
      set({ activeSession: null, isLoading: false });
    }
  },

  startSession: async (clubId, facilityId, courtIds) => {
    set({ isLoading: true });
    try {
      const { data } = await clubSessionApi.start(clubId, { facilityId, courtIds });
      set({ activeSession: data, isLoading: false });
    } catch {
      set({ isLoading: false });
      throw new Error('세션 시작에 실패했습니다');
    }
  },

  endSession: async (sessionId) => {
    set({ isLoading: true });
    try {
      await clubSessionApi.end(sessionId);
      set({ activeSession: null, isLoading: false });
    } catch {
      set({ isLoading: false });
      throw new Error('세션 종료에 실패했습니다');
    }
  },

  clearSession: () => set({ activeSession: null }),
}));

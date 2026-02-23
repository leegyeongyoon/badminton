import { create } from 'zustand';
import { courtApi } from '../services/court';
import api from '../services/api';

interface TurnPlayer {
  id: string;
  userId: string;
  userName: string;
}

interface CourtTurn {
  id: string;
  courtId: string;
  position: number;
  status: string;
  gameType: string;
  createdById: string;
  createdByName: string;
  players: TurnPlayer[];
  game: any | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeLimitAt: string | null;
}

interface CourtDetail {
  court: {
    id: string;
    name: string;
    facilityId: string;
    status: string;
    gameType: string;
    playersRequired: number;
  };
  turns: CourtTurn[];
  maxTurns: number;
}

interface MyTurn {
  turnId: string;
  courtName: string;
  position: number;
  status: string;
  gameType: string;
  players: TurnPlayer[];
  timeLimitAt: string | null;
}

interface TurnState {
  courtDetail: CourtDetail | null;
  myTurns: MyTurn[];
  isLoading: boolean;

  fetchCourtTurns: (courtId: string) => Promise<void>;
  fetchMyTurns: () => Promise<void>;
}

export const useTurnStore = create<TurnState>((set) => ({
  courtDetail: null,
  myTurns: [],
  isLoading: false,

  fetchCourtTurns: async (courtId) => {
    set({ isLoading: true });
    try {
      const { data } = await courtApi.getTurns(courtId);
      set({ courtDetail: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMyTurns: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get('/users/me/turns/current');
      set({ myTurns: data, isLoading: false });
    } catch {
      set({ myTurns: [], isLoading: false });
    }
  },
}));

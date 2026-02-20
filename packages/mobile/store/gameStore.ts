import { create } from 'zustand';
import api from '../services/api';

interface MyGame {
  gameId: string;
  courtName: string;
  order: number;
  status: string;
  teammates: {
    id: string;
    userId: string;
    userName: string;
    callStatus: string;
  }[];
  myCallStatus: string;
}

interface GameState {
  myGame: MyGame | null;
  isLoading: boolean;
  fetchMyGame: () => Promise<void>;
}

export const useGameStore = create<GameState>((set) => ({
  myGame: null,
  isLoading: false,

  fetchMyGame: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get('/users/me/games/current');
      set({ myGame: data, isLoading: false });
    } catch {
      set({ myGame: null, isLoading: false });
    }
  },
}));

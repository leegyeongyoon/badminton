import { create } from 'zustand';
import { facilityApi } from '../services/facility';

interface Facility {
  id: string;
  name: string;
  address: string;
  courts: Court[];
}

interface Court {
  id: string;
  name: string;
  status: string;
  facilityId: string;
}

interface FacilityState {
  facilities: Facility[];
  currentFacility: Facility | null;
  boardData: any[];
  isLoading: boolean;
  fetchFacilities: () => Promise<void>;
  fetchFacility: (id: string) => Promise<void>;
  fetchBoard: (id: string) => Promise<void>;
}

export const useFacilityStore = create<FacilityState>((set) => ({
  facilities: [],
  currentFacility: null,
  boardData: [],
  isLoading: false,

  fetchFacilities: async () => {
    set({ isLoading: true });
    try {
      const { data } = await facilityApi.list();
      set({ facilities: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchFacility: async (id) => {
    set({ isLoading: true });
    try {
      const { data } = await facilityApi.get(id);
      set({ currentFacility: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchBoard: async (id) => {
    try {
      const { data } = await facilityApi.getBoard(id);
      set({ boardData: data });
    } catch {
      // silent
    }
  },
}));

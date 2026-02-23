import { create } from 'zustand';
import { facilityApi } from '../services/facility';
import { getItem, setItem, deleteItem } from '../services/storage';

const SELECTED_FACILITY_KEY = 'selectedFacility';

interface FacilityListItem {
  id: string;
  name: string;
  address: string;
  courtCount?: number;
  hasOpenSession?: boolean;
  checkedInCount?: number;
  latitude?: number;
  longitude?: number;
}

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
  facilities: FacilityListItem[];
  currentFacility: Facility | null;
  boardData: any[];
  isLoading: boolean;
  selectedFacility: FacilityListItem | null;
  selectedFacilityLoaded: boolean;
  fetchFacilities: () => Promise<void>;
  fetchFacility: (id: string) => Promise<void>;
  fetchBoard: (id: string) => Promise<void>;
  loadSelectedFacility: () => Promise<void>;
  selectFacility: (facility: FacilityListItem) => Promise<void>;
  clearSelectedFacility: () => Promise<void>;
}

export const useFacilityStore = create<FacilityState>((set) => ({
  facilities: [],
  currentFacility: null,
  boardData: [],
  isLoading: false,
  selectedFacility: null,
  selectedFacilityLoaded: false,

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
    } catch (err: any) {
      // If facility not found (404), clear the selected facility
      if (err?.response?.status === 404) {
        await deleteItem(SELECTED_FACILITY_KEY);
        set({ selectedFacility: null, boardData: [] });
      }
    }
  },

  loadSelectedFacility: async () => {
    try {
      const stored = await getItem(SELECTED_FACILITY_KEY);
      if (stored) {
        const facility = JSON.parse(stored) as FacilityListItem;
        set({ selectedFacility: facility, selectedFacilityLoaded: true });
      } else {
        set({ selectedFacilityLoaded: true });
      }
    } catch {
      set({ selectedFacilityLoaded: true });
    }
  },

  selectFacility: async (facility) => {
    await setItem(SELECTED_FACILITY_KEY, JSON.stringify(facility));
    set({ selectedFacility: facility });
  },

  clearSelectedFacility: async () => {
    await deleteItem(SELECTED_FACILITY_KEY);
    set({ selectedFacility: null });
  },
}));

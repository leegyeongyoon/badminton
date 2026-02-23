import { create } from 'zustand';
import { clubApi } from '../services/club';

interface Club {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  role?: string;
  isLeader?: boolean;
}

interface ClubMember {
  userId: string;
  name: string;
  role: string;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: string | null;
}

interface ClubState {
  clubs: Club[];
  currentMembers: ClubMember[];
  isLoading: boolean;
  fetchClubs: () => Promise<void>;
  createClub: (name: string) => Promise<void>;
  joinClub: (inviteCode: string) => Promise<void>;
  fetchMembers: (clubId: string) => Promise<void>;
}

export const useClubStore = create<ClubState>((set) => ({
  clubs: [],
  currentMembers: [],
  isLoading: false,

  fetchClubs: async () => {
    set({ isLoading: true });
    try {
      const { data } = await clubApi.list();
      // Map role to isLeader for backward compatibility
      const mapped = data.map((c: any) => ({
        ...c,
        isLeader: c.role === 'LEADER',
      }));
      set({ clubs: mapped, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createClub: async (name) => {
    await clubApi.create(name);
  },

  joinClub: async (inviteCode) => {
    await clubApi.join(inviteCode);
  },

  fetchMembers: async (clubId) => {
    const { data } = await clubApi.getMembers(clubId);
    set({ currentMembers: data });
  },
}));

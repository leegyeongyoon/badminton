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
  skillLevel: string | null;
  gender: string | null;
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
  /** Joins the club for the given invite code and returns the joined club's id. */
  joinClub: (inviteCode: string) => Promise<string>;
  /** Hard-deletes a club, then drops it from the local list. */
  deleteClub: (clubId: string) => Promise<void>;
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
    const { data } = await clubApi.join(inviteCode);
    // Refresh the club list so the newly-joined club is available locally.
    try {
      const { data: clubs } = await clubApi.list();
      const mapped = clubs.map((c: any) => ({ ...c, isLeader: c.role === 'LEADER' }));
      set({ clubs: mapped });
    } catch {
      // Non-fatal — navigation can still proceed with the returned clubId.
    }
    return data.clubId;
  },

  deleteClub: async (clubId) => {
    await clubApi.deleteClub(clubId);
    // Drop it locally so the home list / club list reflect the deletion at once.
    set((state) => ({ clubs: state.clubs.filter((c) => c.id !== clubId) }));
  },

  fetchMembers: async (clubId) => {
    const { data } = await clubApi.getMembers(clubId);
    set({ currentMembers: data });
  },
}));

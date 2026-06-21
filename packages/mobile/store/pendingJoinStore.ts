import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';

/**
 * Pending club-join store (모임 참여 대기).
 *
 * Holds an invite code captured from a /join?code=... deep link BEFORE the user
 * is authenticated. It is persisted to storage so it survives the whole auth
 * flow (login → profile-setup) and even a full reload. Once the user is
 * authenticated AND has a complete profile, the root layout gate consumes it:
 * it joins the club, clears the pending code, and navigates into the club.
 */

const PENDING_JOIN_KEY = 'badminton_pending_invite_code';

interface PendingJoinState {
  pendingInviteCode: string | null;
  /** True once the persisted value has been read at startup. */
  loaded: boolean;
  loadPendingJoin: () => Promise<void>;
  setPendingInviteCode: (code: string) => Promise<void>;
  clearPendingInviteCode: () => Promise<void>;
}

export const usePendingJoinStore = create<PendingJoinState>((set) => ({
  pendingInviteCode: null,
  loaded: false,

  loadPendingJoin: async () => {
    try {
      const value = await getItem(PENDING_JOIN_KEY);
      set({ pendingInviteCode: value || null, loaded: true });
    } catch {
      set({ pendingInviteCode: null, loaded: true });
    }
  },

  setPendingInviteCode: async (code) => {
    set({ pendingInviteCode: code });
    try {
      await setItem(PENDING_JOIN_KEY, code);
    } catch {
      // Persistence failure is non-critical — the in-memory value still works
      // for the current session.
    }
  },

  clearPendingInviteCode: async () => {
    set({ pendingInviteCode: null });
    try {
      await deleteItem(PENDING_JOIN_KEY);
    } catch {
      // noop
    }
  },
}));

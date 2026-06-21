import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';

/**
 * Pending 정모 출석 store (정모 출석 대기).
 *
 * Holds a clubSessionId captured from an /attend?session=... deep link BEFORE the
 * user is authenticated. It is persisted to storage so it survives the whole auth
 * flow (login → profile-setup) and even a full reload. Once the user is
 * authenticated AND has a complete profile, the root layout gate consumes it: it
 * unconditionally checks the user into the 정모 (no geofence — the QR at the venue
 * is the presence proof), clears the pending id, and navigates to the live 현황
 * 보드. Mirrors pendingJoinStore.
 */

const PENDING_ATTEND_KEY = 'badminton_pending_attend_session';

interface PendingAttendState {
  pendingAttendSessionId: string | null;
  /** True once the persisted value has been read at startup. */
  loaded: boolean;
  loadPendingAttend: () => Promise<void>;
  setPendingAttendSessionId: (sessionId: string) => Promise<void>;
  clearPendingAttendSessionId: () => Promise<void>;
}

export const usePendingAttendStore = create<PendingAttendState>((set) => ({
  pendingAttendSessionId: null,
  loaded: false,

  loadPendingAttend: async () => {
    try {
      const value = await getItem(PENDING_ATTEND_KEY);
      set({ pendingAttendSessionId: value || null, loaded: true });
    } catch {
      set({ pendingAttendSessionId: null, loaded: true });
    }
  },

  setPendingAttendSessionId: async (sessionId) => {
    set({ pendingAttendSessionId: sessionId });
    try {
      await setItem(PENDING_ATTEND_KEY, sessionId);
    } catch {
      // Persistence failure is non-critical — the in-memory value still works
      // for the current session.
    }
  },

  clearPendingAttendSessionId: async () => {
    set({ pendingAttendSessionId: null });
    try {
      await deleteItem(PENDING_ATTEND_KEY);
    } catch {
      // noop
    }
  },
}));

import { create } from 'zustand';
import api from '../services/api';

interface NotificationStore {
  unreadCount: number;
  /** Re-fetch the unread count from the server (the single source of truth). */
  refresh: () => Promise<void>;
}

/**
 * Single source of truth for the unread-notification badge.
 *
 * Previously the tab badge (`(tabs)/_layout.tsx`), 더보기 and 설정 each fetched
 * `/notifications` and counted `!read` INDEPENDENTLY, and the tab badge only
 * re-polled every 30s. So after a user opened a notification, the badge number
 * kept showing the old count until the next poll — it looked like "읽어도 숫자가
 *안 사라진다". Now every consumer reads `unreadCount` from here, and
 * `notifications.tsx` calls `refresh()` right after marking read (single or all),
 * so the badge drops immediately everywhere.
 */
export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,
  refresh: async () => {
    try {
      const { data } = await api.get('/notifications', { params: { limit: 50 } });
      const count = Array.isArray(data) ? data.filter((n: { read?: boolean }) => !n.read).length : 0;
      set({ unreadCount: count });
    } catch {
      /* keep the previous count on a transient failure */
    }
  },
}));

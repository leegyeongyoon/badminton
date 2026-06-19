import api from './api';

// ─── Attendance leaderboard (출석왕) ─────────────────────────
export type AttendancePeriod = 'month' | 'season' | 'all';

export interface AttendanceEntry {
  userId: string;
  name: string;
  skillLevel: string | null;
  attendanceCount: number;
  /** Dense rank (ties share a rank), 1-based. */
  rank: number;
}

export interface AttendanceLeaderboard {
  period: AttendancePeriod;
  entries: AttendanceEntry[];
  /** The caller's own entry, or null if they have no attendance yet. */
  me: AttendanceEntry | null;
}

export const clubApi = {
  list: () => api.get('/clubs'),
  create: (name: string) => api.post('/clubs', { name }),
  join: (inviteCode: string) => api.post('/clubs/join', { inviteCode }),
  getMembers: (clubId: string) => api.get(`/clubs/${clubId}/members`),
  getAttendanceLeaderboard: (clubId: string, period: AttendancePeriod) =>
    api.get<AttendanceLeaderboard>(`/clubs/${clubId}/attendance/leaderboard`, {
      params: { period },
    }),
  getMyAttendance: (clubId: string, period: AttendancePeriod) =>
    api.get<AttendanceEntry | null>(`/clubs/${clubId}/attendance/me`, {
      params: { period },
    }),
};

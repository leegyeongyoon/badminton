import api from './api';

// ─── Attendance leaderboard (출석왕) ─────────────────────────
export type AttendancePeriod = 'month' | 'year' | 'all';

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

// POST /clubs/join response — exposes the joined club id so callers can navigate.
export interface JoinClubResult {
  success: boolean;
  clubId: string;
  clubName: string;
}

// GET /clubs/:id/invite-qr response (모임 참여 QR).
export interface ClubInviteQr {
  inviteCode: string;
  /** "<WEB_BASE_URL>/join?code=<inviteCode>" — scanning opens the web /join route. */
  joinUrl: string;
  /** Ready-to-display PNG data URL (data:image/png;base64,...). */
  qr: string;
}

export const clubApi = {
  list: () => api.get('/clubs'),
  create: (name: string) => api.post('/clubs', { name }),
  join: (inviteCode: string) => api.post<JoinClubResult>('/clubs/join', { inviteCode }),
  getInviteQr: (clubId: string) => api.get<ClubInviteQr>(`/clubs/${clubId}/invite-qr`),
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

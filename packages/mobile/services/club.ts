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

// ─── 운영자 관리 멤버 (앱 미사용, 영구 멤버) ─────────────────
export interface ManagedMemberInput {
  name: string;
  skillLevel?: string;
  gender?: 'M' | 'F' | null;
}

export interface ManagedMember {
  userId: string;
  name: string;
  role: string;
  skillLevel: string | null;
  gender: string | null;
}

export interface BulkAddManagedMembersResult {
  created: ManagedMember[];
  /** 이미 등록된 동일 이름(중복) — 건너뜀. */
  skipped: string[];
}

export const clubApi = {
  list: () => api.get('/clubs'),
  create: (name: string) => api.post('/clubs', { name }),
  join: (inviteCode: string) => api.post<JoinClubResult>('/clubs/join', { inviteCode }),
  getInviteQr: (clubId: string) => api.get<ClubInviteQr>(`/clubs/${clubId}/invite-qr`),
  getMembers: (clubId: string) => api.get(`/clubs/${clubId}/members`),

  // 운영자 관리 멤버 일괄 등록 (LEADER/STAFF) — 앱 로그인 없는 영구 멤버 생성.
  bulkAddMembers: (clubId: string, members: ManagedMemberInput[]) =>
    api.post<BulkAddManagedMembersResult>(`/clubs/${clubId}/members/bulk`, { members }),
  getAttendanceLeaderboard: (clubId: string, period: AttendancePeriod) =>
    api.get<AttendanceLeaderboard>(`/clubs/${clubId}/attendance/leaderboard`, {
      params: { period },
    }),
  getMyAttendance: (clubId: string, period: AttendancePeriod) =>
    api.get<AttendanceEntry | null>(`/clubs/${clubId}/attendance/me`, {
      params: { period },
    }),
};

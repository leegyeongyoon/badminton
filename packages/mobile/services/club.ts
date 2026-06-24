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

// PATCH /clubs/:id body — 모임 정보 수정 (LEADER/SUPER_ADMIN). 최소 한 필드.
export interface UpdateClubBody {
  name?: string;
  homeFacilityId?: string | null;
  description?: string | null;
}

// 모임 정보 응답 (create/list/update 공통).
export interface ClubInfo {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  homeFacilityId: string | null;
  memberCount: number;
  role?: string;
  createdAt: string;
}

export const clubApi = {
  list: () => api.get('/clubs'),
  create: (name: string) => api.post('/clubs', { name }),
  // 모임 정보 수정 (이름/홈시설/소개). 서버 권한: 해당 모임 LEADER 또는 SUPER_ADMIN.
  updateClub: (id: string, body: UpdateClubBody) =>
    api.patch<ClubInfo>(`/clubs/${id}`, body),
  // 초대코드 재발급 — 기존 코드/QR/링크는 즉시 무효화됨.
  regenerateInvite: (id: string) =>
    api.post<{ inviteCode: string }>(`/clubs/${id}/invite-code/regenerate`),
  // 모임 삭제 — 모임과 모든 하위 데이터(정모/코트/체크인 등)를 영구 삭제.
  // 서버에서 권한 확인(SUPER_ADMIN 또는 해당 모임 LEADER/STAFF).
  deleteClub: (id: string) => api.delete<{ success: boolean }>(`/clubs/${id}`),
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

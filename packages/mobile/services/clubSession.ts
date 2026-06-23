import api from './api';

export interface GuestFeeItem {
  checkInId: string;
  userId: string;
  guestName: string;
  feeAmount: number | null;
  feePaid: boolean;
}

export interface GuestFeeSettlement {
  clubSessionId: string;
  items: GuestFeeItem[];
  totals: {
    totalFee: number;
    paidFee: number;
    unpaidFee: number;
    guestCount: number;
  };
}

// ─── 매치업 (오늘 함께 친 사람) ───
export interface MatchupPartner {
  userId: string;
  name: string;
  skillLevel?: string | null;
  gender?: 'M' | 'F' | null;
  /** 이 정모에서 함께 친 게임 수. */
  count: number;
}

export interface PlayerMatchups {
  userId: string;
  /** 이 정모에서 플레이한 총 게임 수. */
  totalGames: number;
  /** 함께 친 파트너 목록 (count 내림차순). */
  partners: MatchupPartner[];
}

// ─── 정모 종료 요약 리포트 ───
export interface SessionSummary {
  session: {
    title?: string | null;
    startedAt: string;
    endedAt: string | null;
    status: string;
  };
  attendance: {
    memberCount: number;
    guestCount: number;
    total: number;
    members: Array<{ userId: string; name: string; gamesPlayed: number }>;
    guests: Array<{ userId: string; name: string; gamesPlayed: number }>;
  };
  games: {
    total: number;
    perPlayer: Array<{ userId: string; name: string; count: number }>;
  };
  guestFees: {
    totalFee: number;
    paidFee: number;
    unpaidFee: number;
    guestCount: number;
  };
}

// ─── Per-정모 출석 QR ───
export interface SessionQr {
  clubSessionId: string;
  /** Scannable web URL, e.g. "<WEB_BASE_URL>/attend?session=<clubSessionId>". */
  payload: string;
  /** Ready-to-display PNG data URL (data:image/png;base64,...). */
  qr: string;
}

/** A court owned by THIS 정모 (for the 코트 관리 modal). Each 정모 manages only
 *  its own courts (코트1·2·3); other 모임s' courts are never visible. */
export interface SessionCourt {
  id: string;
  name: string;
  status: string; // EMPTY | IN_USE | MAINTENANCE
}

/** Shape returned by POST /club-sessions/:id/attend (idempotent QR check-in). */
export interface AttendResponse {
  success: boolean;
  clubSessionId: string;
  id: string;
  userId: string;
  facilityId: string;
  facilityName: string;
  checkedInAt: string;
}

export const clubSessionApi = {
  // 정모 시작: 코트 수(courtCount)를 등록하면 서버가 이 정모 전용 코트 1..N을 만든다.
  start: (clubId: string, data: { facilityId: string; courtCount?: number }) =>
    api.post(`/clubs/${clubId}/sessions`, data),

  // 정모 출석용 QR (data URL) — 운영자가 띄워두면 참가자가 스캔해 출석.
  getSessionQr: (clubSessionId: string) =>
    api.get<SessionQr>(`/club-sessions/${clubSessionId}/qr`),

  // 정모 출석 QR 스캔 → 무조건 출석(지오펜스 없음, 멱등). 현황 보드로 이동에 사용.
  attend: (clubSessionId: string) =>
    api.post<AttendResponse>(`/club-sessions/${clubSessionId}/attend`),
  getActive: (clubId: string) =>
    api.get(`/clubs/${clubId}/sessions/active`),

  // 이 정모가 소유한 코트(session.courtIds)만 — 운영판 코트 그리드용.
  getCourts: (sessionId: string) =>
    api.get(`/club-sessions/${sessionId}/courts`),

  // 이 정모가 소유한 코트만 — 코트 관리 모달용 (다른 모임 코트는 안 보임).
  getFacilityCourts: (sessionId: string) =>
    api.get<SessionCourt[]>(`/club-sessions/${sessionId}/facility-courts`),

  // 이 정모에 체크인한 플레이어만 (세션 스코프 풀).
  getPlayers: (sessionId: string) =>
    api.get(`/club-sessions/${sessionId}/players`),

  updateCourts: (sessionId: string, courtIds: string[]) =>
    api.patch(`/club-sessions/${sessionId}/courts`, { courtIds }),

  // 코트 추가 (이 정모 전용): 시설에 충돌 없는 이름("코트 N")으로 새 코트를 만들고
  // 이 정모의 courtIds에 추가. 이름 입력 불필요(자동 생성) — 다른 모임과 충돌 없음.
  addCourt: (sessionId: string) =>
    api.post(`/club-sessions/${sessionId}/courts/add`),
  end: (sessionId: string) =>
    api.post(`/club-sessions/${sessionId}/end`),
  bulkRegisterTurns: (sessionId: string, turns: Array<{ courtId: string; playerIds: string[]; gameType?: string }>) =>
    api.post(`/club-sessions/${sessionId}/turns/bulk`, { turns }),
  updateMemberRole: (clubId: string, userId: string, role: string) =>
    api.patch(`/clubs/${clubId}/members/${userId}/role`, { role }),

  // ─── 게스트 (LEADER/STAFF) ───
  // 게스트 추가 — 새 게스트 유저 + 체크인을 만들어 즉시 풀에 투입
  addGuest: (
    sessionId: string,
    body: { name: string; skillLevel?: string; feeAmount?: number },
  ) => api.post(`/club-sessions/${sessionId}/guests`, body),

  // 테스트/데모용: 랜덤 샘플 게스트 N명을 만들어 즉시 정모에 체크인 (LEADER/STAFF).
  // 일반 게스트와 동일하게 정모 종료 시 사라짐 — 실제 출석과 혼동 금지.
  addRandomGuests: (sessionId: string, count: number) =>
    api.post<{ createdCount: number; clubSessionId: string }>(
      `/club-sessions/${sessionId}/guests/bulk-random`,
      { count },
    ),

  // 게스트비 정산 목록 + 합계
  getGuestFees: (sessionId: string) =>
    api.get<GuestFeeSettlement>(`/club-sessions/${sessionId}/guest-fees`),

  // 게스트 체크인 비용/납부여부 수정
  updateGuestFee: (
    checkInId: string,
    body: { feeAmount?: number | null; feePaid?: boolean },
  ) => api.patch(`/checkins/${checkInId}/fee`, body),

  // 코트 위 게임(턴) 종료
  completeTurn: (turnId: string) => api.post(`/turns/${turnId}/complete`),

  // ─── 운영자: 특정 참가자를 정모에서 체크아웃 (LEADER/STAFF) ───
  // Self-checkout과 동일한 정리(대기 턴 취소·대기 보드에서 제거, 진행 중 게임은 유지)를
  // 수행하고 갱신된 출석 풀을 반환. 게스트도 동작.
  checkoutPlayer: (clubSessionId: string, userId: string) =>
    api.post(`/club-sessions/${clubSessionId}/checkout/${userId}`),

  // ─── 운영자: 참가자 이름·급수 수정 (LEADER/STAFF) ───
  // 운영판에서 바로 이름표를 고치듯 참가자(게스트 포함)의 이름/급수를 수정.
  // name·skillLevel 중 하나 이상 필요. skillLevel: null 이면 미설정으로 초기화.
  editPlayer: (
    sessionId: string,
    userId: string,
    body: { name?: string; skillLevel?: string | null },
  ) =>
    api.patch<{ userId: string; name: string; skillLevel: string | null; isGuest: boolean }>(
      `/club-sessions/${sessionId}/players/${userId}`,
      body,
    ),

  // ─── 운영자: 정모 출석 체크 (관리 멤버 포함, LEADER/STAFF) ───
  // 특정 모임원을 진행 중인 정모에 체크인(출석). 멱등 — 이미 체크인이면 created=false.
  checkInMember: (clubSessionId: string, userId: string) =>
    api.post<{ success: boolean; created: boolean; userId: string; clubSessionId: string }>(
      `/club-sessions/${clubSessionId}/members/${userId}/check-in`,
    ),

  // 아직 체크인 안 된 모든 모임원을 한 번에 체크인 (전체 체크인). 새로 체크인된 수 반환.
  checkInAllMembers: (clubSessionId: string) =>
    api.post<{ success: boolean; checkedInCount: number; clubSessionId: string }>(
      `/club-sessions/${clubSessionId}/members/check-in-all`,
    ),

  // ─── 매치업: 한 선수가 이 정모에서 함께 친 사람 목록 (모든 모임원 조회 가능) ───
  getMatchups: (clubSessionId: string, userId: string) =>
    api.get<PlayerMatchups>(`/club-sessions/${clubSessionId}/players/${userId}/matchups`),

  // ─── 정모 종료 요약 리포트 (ACTIVE/ENDED 모두 동작) ───
  getSummary: (clubSessionId: string) =>
    api.get<SessionSummary>(`/club-sessions/${clubSessionId}/summary`),
};

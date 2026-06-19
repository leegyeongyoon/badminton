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

export const clubSessionApi = {
  start: (clubId: string, data: { facilityId: string; courtIds?: string[] }) =>
    api.post(`/clubs/${clubId}/sessions`, data),
  getActive: (clubId: string) =>
    api.get(`/clubs/${clubId}/sessions/active`),
  updateCourts: (sessionId: string, courtIds: string[]) =>
    api.patch(`/club-sessions/${sessionId}/courts`, { courtIds }),
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

  // ─── 매치업: 한 선수가 이 정모에서 함께 친 사람 목록 (모든 모임원 조회 가능) ───
  getMatchups: (clubSessionId: string, userId: string) =>
    api.get<PlayerMatchups>(`/club-sessions/${clubSessionId}/players/${userId}/matchups`),

  // ─── 정모 종료 요약 리포트 (ACTIVE/ENDED 모두 동작) ───
  getSummary: (clubSessionId: string) =>
    api.get<SessionSummary>(`/club-sessions/${clubSessionId}/summary`),
};

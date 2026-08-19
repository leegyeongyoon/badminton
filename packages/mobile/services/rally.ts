import api from './api';

// 콕고 랠리 PvP — 대결 신청/수락/거절 (서버 rallyGame 모듈).
// 소켓은 무인증이라 신원이 필요한 흐름은 REST로 시작하고,
// 매치 진입 후 릴레이(rally:input/snapshot/event)만 소켓으로 흐른다.

export interface RallyChallengeResponse {
  matchId: string;
}

export interface RallyAcceptResponse {
  matchId: string;
  hostId: string;
  guestId: string;
}

export const rallyApi = {
  // 같은 정모 대기자에게 대결 신청 → 상대에게 rally:invited 소켓 + 푸시
  challenge: (toUserId: string) =>
    api.post<RallyChallengeResponse>('/rally/challenge', { toUserId }),

  accept: (matchId: string) =>
    api.post<RallyAcceptResponse>(`/rally/matches/${matchId}/accept`),

  decline: (matchId: string) =>
    api.post<{ ok: boolean }>(`/rally/matches/${matchId}/decline`),
};

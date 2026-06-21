import api from './api';

/**
 * Board-aware "my upcoming game" status (GET /users/me/status). null = not in an
 * active 정모. Mirrors the shared `MyStatusResponse` type (mobile keeps its own
 * copy to avoid pulling the server-only @badminton/shared package into the metro
 * bundle).
 */
export interface MyStatusResponse {
  status: 'PLAYING' | 'QUEUED' | 'AVAILABLE';
  clubSessionId: string;
  /** 대기 N번째 (QUEUED) / 코트 순번 (on-court WAITING). */
  queueOrder: number | null;
  /** 코트 이름 (PLAYING / on-court WAITING). null = 코트 미정. */
  courtName: string | null;
  /** 내 앞에 남은 게임 수 (대략적 ETA). */
  etaGames: number | null;
  turnId: string | null;
}

export const profileApi = {
  getProfile: () =>
    api.get('/users/me/profile'),
  getMyStatus: () =>
    api.get<MyStatusResponse | null>('/users/me/status'),
  updateProfile: (data: { skillLevel?: string; preferredGameTypes?: string[]; gender?: string | null; birthYear?: number | null }) =>
    api.put('/users/me/profile', data),
  getStats: () =>
    api.get('/users/me/stats'),
  getHistory: (page = 1) =>
    api.get('/users/me/history', { params: { page } }),
  getPenalties: () =>
    api.get('/users/me/penalties'),
};

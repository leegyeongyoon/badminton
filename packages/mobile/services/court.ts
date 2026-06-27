import api from './api';

export const courtApi = {
  // ─── 코트 관리 (LEADER/STAFF) ───
  list: (facilityId: string) =>
    api.get(`/facilities/${facilityId}/courts`),
  create: (facilityId: string, name: string, gameType?: string) =>
    api.post(`/facilities/${facilityId}/courts`, { name, ...(gameType ? { gameType } : {}) }),
  rename: (courtId: string, name: string) =>
    api.patch(`/courts/${courtId}`, { name }),
  // Delete a court. Server returns 400 ({error}) if the court is IN_USE or has
  // usage history — the caller should surface that friendly message, not crash.
  remove: (courtId: string) =>
    api.delete(`/courts/${courtId}`),
  // status: 'EMPTY' (사용 가능) | 'MAINTENANCE' (사용 불가)
  setAvailable: (courtId: string) =>
    api.patch(`/courts/${courtId}/status`, { status: 'EMPTY' }),
  setUnavailable: (courtId: string) =>
    api.patch(`/courts/${courtId}/status`, { status: 'MAINTENANCE' }),

  updateStatus: (courtId: string, status: string) =>
    api.patch(`/courts/${courtId}/status`, { status }),
  getTurns: (courtId: string) =>
    api.get(`/courts/${courtId}/turns`),
  registerTurn: (courtId: string, playerIds: string[], gameType?: string) =>
    api.post(`/courts/${courtId}/turns`, { playerIds, ...(gameType && { gameType }) }),
  completeTurn: (turnId: string) =>
    api.post(`/turns/${turnId}/complete`),
  // 게임 종료 / 코트 비우기 BY COURT — robust: the server resolves whatever is
  // actually PLAYING on this court and completes it (+ cancels leftover WAITING
  // turns), so it can't get stuck on a stale client turnId. Frees the players.
  completeActiveByCourt: (courtId: string) =>
    api.post(`/courts/${courtId}/complete-active`),
  cancelTurn: (turnId: string) =>
    api.post(`/turns/${turnId}/cancel`),
  requeueTurn: (turnId: string, options?: { newPlayerIds?: string[]; targetCourtId?: string }) =>
    api.post(`/turns/${turnId}/requeue`, options || {}),
  extendTurn: (turnId: string, minutes: number) =>
    api.post(`/turns/${turnId}/extend`, { minutes }),
};

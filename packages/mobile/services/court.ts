import api from './api';

export const courtApi = {
  updateStatus: (courtId: string, status: string) =>
    api.patch(`/courts/${courtId}/status`, { status }),
  getTurns: (courtId: string) =>
    api.get(`/courts/${courtId}/turns`),
  registerTurn: (courtId: string, playerIds: string[], gameType?: string) =>
    api.post(`/courts/${courtId}/turns`, { playerIds, ...(gameType && { gameType }) }),
  completeTurn: (turnId: string) =>
    api.post(`/turns/${turnId}/complete`),
  cancelTurn: (turnId: string) =>
    api.post(`/turns/${turnId}/cancel`),
  requeueTurn: (turnId: string, options?: { newPlayerIds?: string[]; targetCourtId?: string }) =>
    api.post(`/turns/${turnId}/requeue`, options || {}),
  extendTurn: (turnId: string, minutes: number) =>
    api.post(`/turns/${turnId}/extend`, { minutes }),
};

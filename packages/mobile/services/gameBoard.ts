import api from './api';

export const gameBoardApi = {
  create: (clubSessionId: string) =>
    api.post(`/club-sessions/${clubSessionId}/game-board`),

  get: (clubSessionId: string) =>
    api.get(`/club-sessions/${clubSessionId}/game-board`),

  // courtId is optional — 대기만 등록할 때는 코트 지정 안 함
  addEntry: (boardId: string, playerIds: string[], courtId?: string) =>
    api.post(`/game-boards/${boardId}/entries`, { playerIds, courtId }),

  updateEntry: (boardId: string, entryId: string, playerIds: string[]) =>
    api.patch(`/game-boards/${boardId}/entries/${entryId}`, { playerIds }),

  deleteEntry: (boardId: string, entryId: string) =>
    api.delete(`/game-boards/${boardId}/entries/${entryId}`),

  // courtId required — 대기 게임을 특정 코트에 걸기
  pushEntry: (boardId: string, entryId: string, courtId: string) =>
    api.post(`/game-boards/${boardId}/entries/${entryId}/push`, { courtId }),

  pushAll: (boardId: string) =>
    api.post(`/game-boards/${boardId}/push-all`),
};

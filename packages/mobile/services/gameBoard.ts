import api from './api';

// 자동 추천 매칭 모드 (서버 suggestFoursomeSchema.mode 와 1:1).
// 5개 모드가 실력 격차 스펙트럼(비슷 → 중간 → 큰 격차)을 이룸.
export type SuggestMode =
  | 'fair'
  | 'similar'
  | 'balanced'
  | 'competitive'
  | 'fresh';

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

  // 자동 추천 — 다음 복식 4인 조합 제안 (LEADER/STAFF 전용, 인원 부족 시 [])
  // mode: 매칭 전략 (fair/similar/balanced/competitive/fresh), 기본 fair
  // exclude: 이미 트레이에 올려둔/큐에 편성된 인원 → 풀에서 제외 (연속 편성 시 새 인원)
  suggest: (
    clubSessionId: string,
    body?: { courtId?: string; count?: number; mode?: SuggestMode; exclude?: string[] },
  ) => api.post(`/club-sessions/${clubSessionId}/suggest`, body ?? {}),

  // ─── 전체 "다음 게임" 큐 (코트 없는 QUEUED 게임) ───
  // 큐에 게임 추가 (2명 또는 4명) — 큐 끝에 append
  createQueueGame: (boardId: string, playerIds: string[], note?: string) =>
    api.post(`/game-boards/${boardId}/queue`, { playerIds, ...(note ? { note } : {}) }),

  // 큐 순서 변경 (드래그앤드롭/▲▼) — QUEUED 엔트리 id의 새 전체 순서
  reorderQueue: (boardId: string, entryIds: string[]) =>
    api.patch(`/game-boards/${boardId}/queue/reorder`, { entryIds }),

  // 큐 게임을 빈(EMPTY) 코트에 배정 → 게임 시작 (your_turn push)
  assignEntry: (boardId: string, entryId: string, courtId: string) =>
    api.post(`/game-boards/${boardId}/entries/${entryId}/assign`, { courtId }),

  // 모드2 자석판: 이름표 1개 위치(분수) 갱신 → 운영진 공유(소켓 전파). 드래그 릴리즈마다.
  updateLayout: (boardId: string, userId: string, x: number, y: number) =>
    api.patch(`/game-boards/${boardId}/layout`, { userId, x, y }),
};

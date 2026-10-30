import api from './api';

// 자동 추천 매칭 모드 (서버 suggestFoursomeSchema.mode 와 1:1).
// 5개 모드가 실력 격차 스펙트럼(비슷 → 중간 → 큰 격차)을 이룸.
export type SuggestMode =
  | 'fair'
  | 'similar'
  | 'balanced'
  | 'competitive'
  | 'fresh';

// 운영자 조율값 (서버 suggestFoursomeSchema.tuning 와 1:1). 미지정 항목은 서버 기본값.
export type SuggestTuning = {
  genderOffsetFemale?: number; // 여자 급수 보정폭(−2~0, 0=끔)
  sameGenderWeight?: number;   // 동성 복식 선호 강도(0~2, 0=끔)
  typeVarietyWeight?: number;  // 타입 순환 강도(0~2, 0=끔)
};

// 운영판 '편성 기준' (서버 suggestFoursomeSchema.prefs 와 1:1) — 주면 mode·동성/순환 tuning보다 우선.
export type SuggestPrefs = {
  levelMatch?: 'tight' | 'normal' | 'loose';   // 급수 맞추기: 딱 맞게 / 보통 / 넉넉하게
  gameType?: 'same' | 'even' | 'mixed';        // (예전) 게임 종류 — 지금 앱은 mixedRatio 를 보냄
  mixedRatio?: number;                         // 혼복 비율 목표(0~100%) — 오늘 전체 판 기준
  avoidRepeat?: 'normal' | 'strong';           // 같은 사람과 또: 보통 / 최대한 피하기
};

// AI 편성 설정(모임 단위, 운영진 공유) — 서버 autoMatchSettingsSchema 와 1:1.
export type AutoLevelSetting = {
  mixedPct?: number | null; // 이 급수·성별 혼복 비율(null = 모임 비율)
  up?: number | null;       // 같은 성별 기준 위로 몇 단계까지 같이(null = 제한 없음)
  down?: number | null;     // 아래로 몇 단계까지
  games?: 'less' | 'normal' | 'more'; // 판수 비중
};
export type AutoMatchSettings = {
  levelMatch?: 'tight' | 'normal' | 'loose' | 'custom';
  spread2MaxPct?: number;
  mixedRatio?: number;
  avoidRepeat?: 'normal' | 'strong';
  gameBalance?: 'auto' | 'gap1' | 'gap2' | 'gap3';
  levels?: Record<string, AutoLevelSetting>; // 키: 'M'|'F' + 급수 글자(예 'FF' = 여자 F조)
};
export type ResolvedAutoSettings = Required<Omit<AutoMatchSettings, 'levels'>> & {
  levels: Record<string, Required<AutoLevelSetting>>;
};

// AI 학습 현황(최근 14일) — AI가 짠 판을 운영진이 그대로/고침/지움, 회원 반응, 설정 추천.
export type AiInsights = {
  days: number;
  ai: { total: number; kept: number; edited: number; deleted: number; tighter: number; looser: number; toSame: number; toMixed: number };
  feedback: { total: number; GOOD: number; OK: number; BAD: number; reasons: Record<'TOO_HARD' | 'TOO_EASY' | 'REPEAT' | 'WAIT', number> & { UNBALANCED?: number } };
  recommendations: { text: string; why: string; patch: AutoMatchSettings }[];
  // 운영진이 직접 짠 판 vs 그 순간 AI라면 — 같은 4명 판 수·평균 겹친 인원.
  shadow?: { total: number; exact: number; avgSame: number };
  // 경기 반응으로 본 '급수 확인이 필요해 보이는 회원'(최근 60일, 한쪽으로 3번+). 자동으로 바꾸지 않음.
  levelHints?: { userId: string; name: string; level: string | null; hard: number; easy: number; suggest: 'down' | 'up' }[];
};
export type FeedbackRating = 'GOOD' | 'OK' | 'BAD';
export type FeedbackReason = 'TOO_HARD' | 'TOO_EASY' | 'UNBALANCED' | 'REPEAT' | 'WAIT';
export type PendingFeedback = { turnId: string; courtName: string; completedAt: string; others: string[] };

// 모임 학습 스타일 요약 — 서버가 이 모임의 과거 편성 기록에서 배운 '묶는 방식'.
export type ClubStyleSummary = {
  decisions: number;            // 학습에 쓴 편성 수
  editSamples?: number;         // 학습에 넣은 '운영진이 고친 AI 판' 수
  testAccuracy: number | null;  // 실제 조합을 맞힌 비율(%) — 최근 20% 정모로 검증
  traits: string[];             // 예: ['남복·여복 위주', '급수 비슷한 사람끼리']
  trainedAt: string;
};

// 운영진 편성 요청 — 자동 편성이 지킨다. TOGETHER=파트너로 같이(games 판, null=계속), APART=같이 안 짜기.
export type RequestKind = 'TOGETHER' | 'APART';
export type SessionRequest = {
  id: string;
  kind: RequestKind;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  games: number | null;        // 목표 누적 판수(서버가 '지금부터 N판'을 누적치로 저장)
  playedTogether: number;      // 이번 정모에서 실제 같이 친 판수
  remaining: number | null;    // 남은 판수(0=완료), APART·계속은 null
  note: string | null;
  createdAt: string;
};

// 정모 페이스(실데이터) — 판당 시간 + 1인 주기 + 학습 스타일.
export type GameFormat = '21' | '25' | '15';

export type SessionPace = {
  medianGameMin: number;
  p75GameMin: number;
  firstHourGameMin: number;
  laterGameMin: number;
  /** 지금 시점(정모 첫 1시간이면 더 긺)에 맞는 판당 시간. */
  currentGameMin: number;
  personCycleMin: number;
  courts: number;
  rotatingPlayers: number;
  sample: number;
  source: 'club' | 'default';
  style: ClubStyleSummary | null;
  /** 오늘 혼복 판수 / 전체 판수(시작된 판 + 대기 게임). */
  mixToday?: { mixed: number; total: number };
  /** 오늘 급수 차이별 판수 [같은 급수, 1단계, 2단계, 3단계+]. */
  spreadToday?: number[];
  /** 지금 있는 사람 판수(대기 게임 포함) 최소·최대. */
  gamesToday?: { min: number; max: number } | null;
  /** 지금 있는 사람 급수·성별별 인원(키 예 'FF'). */
  levelCounts?: Record<string, number>;
  /** 경기 방식(점수) + 방식별 보통 판 예상(분) + 예측에 쓴 완료 판 수. */
  gameFormat?: GameFormat;
  formatMinutes?: Record<GameFormat, number>;
  durationSample?: number;
  /** 진행 중 코트별 예상 시간 — 이 4명·이 방식으로 예측. */
  courtEtas?: { courtId: string; predictedMin: number; endsAt: string }[];
};

export const gameBoardApi = {
  create: (clubSessionId: string) =>
    api.post(`/club-sessions/${clubSessionId}/game-board`),

  get: (clubSessionId: string) =>
    api.get(`/club-sessions/${clubSessionId}/game-board`),

  // courtId is optional — 대기만 등록할 때는 코트 지정 안 함
  addEntry: (boardId: string, playerIds: string[], courtId?: string) =>
    api.post(`/game-boards/${boardId}/entries`, { playerIds, courtId }),

  // extra: 자동 채우기가 이유(note)·팀 구성(teamSplit)을 함께 갱신할 때.
  updateEntry: (boardId: string, entryId: string, playerIds: string[], extra?: { note?: string | null; teamSplit?: boolean }) =>
    api.patch(`/game-boards/${boardId}/entries/${entryId}`, { playerIds, ...(extra ?? {}) }),

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
  // target: 대상 게임 모드 — fill(대기 게임 빈자리 채우기) / substitute(땜빵 후보 3명; 대기 게임 entryId 또는 코트 turnId)
  // 늦게 온 사람·짜둔 판에서 빠져 오래 기다린 사람이 생기면 손대지 않은 AI 대기 게임을 지운다 — 자동 편성이 다시 짠다.
  replanStale: (clubSessionId: string) =>
    api.post<{ removed: number }>(`/club-sessions/${clubSessionId}/replan-stale`, {}, { _silent: true } as any),

  suggest: (
    clubSessionId: string,
    body?: {
      courtId?: string;
      count?: number;
      mode?: SuggestMode;
      exclude?: string[];
      tuning?: SuggestTuning;
      prefs?: SuggestPrefs;
      target?: { kind: 'fill' | 'substitute'; entryId?: string; turnId?: string; outUserId?: string };
      // 채우기 조건(AI 명령) — fill 에 entryId 가 없으면 대기 맨 뒤 새 게임을 처음부터 짠다.
      want?: { gameType?: 'mixed' | 'men' | 'women' | 'same'; level?: 'up' | 'down' };
    },
  ) => api.post(`/club-sessions/${clubSessionId}/suggest`, body ?? {}),

  // 운영진 편성 요청(파트너/같이 안 짜기) — 목록·추가(같은 두 사람이면 교체)·삭제. 대표/운영진만.
  requests: (clubSessionId: string) => api.get<SessionRequest[]>(`/club-sessions/${clubSessionId}/requests`),
  createRequest: (
    clubSessionId: string,
    body: { kind: RequestKind; aId: string; bId: string; games?: number | null; note?: string | null },
  ) => api.post<SessionRequest[]>(`/club-sessions/${clubSessionId}/requests`, body),
  deleteRequest: (clubSessionId: string, requestId: string) =>
    api.delete<SessionRequest[]>(`/club-sessions/${clubSessionId}/requests/${requestId}`),

  // 이 모임 실데이터 판당 시간·1인 주기·학습 스타일(읽기 전용)
  pace: (clubSessionId: string) => api.get<SessionPace>(`/club-sessions/${clubSessionId}/pace`),
  setGameFormat: (clubSessionId: string, format: GameFormat) =>
    api.put<{ gameFormat: GameFormat }>(`/club-sessions/${clubSessionId}/game-format`, { format }),
  aiInsights: (clubSessionId: string) => api.get<AiInsights>(`/club-sessions/${clubSessionId}/ai-insights`),
  // 회원 경기 후 반응
  pendingFeedback: (turnId?: string) =>
    api.get<{ pending: PendingFeedback | null }>(`/club-sessions/feedback/pending`, { params: turnId ? { turnId } : {} }),
  submitFeedback: (turnId: string, rating: FeedbackRating, reason?: FeedbackReason) =>
    api.post(`/club-sessions/feedback`, { turnId, rating, ...(reason ? { reason } : {}) }),
  // AI 편성 설정 — 모임 단위(정모 id로 모임을 찾음). 운영진만.
  getAutoSettings: (clubSessionId: string) =>
    api.get<{ saved: AutoMatchSettings | null; resolved: ResolvedAutoSettings }>(`/club-sessions/${clubSessionId}/auto-settings`),
  saveAutoSettings: (clubSessionId: string, settings: AutoMatchSettings) =>
    api.put<{ saved: AutoMatchSettings; resolved: ResolvedAutoSettings }>(`/club-sessions/${clubSessionId}/auto-settings`, settings),

  // ─── 전체 "다음 게임" 큐 (코트 없는 QUEUED 게임) ───
  // 큐에 게임 추가 (2명 또는 4명) — 큐 끝에 append.
  // teamSplit: playerIds 순서가 [A1, A2, B1, B2] 팀 구성(자동 편성), note: 왜 이 4명인지.
  createQueueGame: (boardId: string, playerIds: string[], note?: string, teamSplit?: boolean) =>
    api.post(`/game-boards/${boardId}/queue`, {
      playerIds,
      ...(note ? { note } : {}),
      ...(teamSplit ? { teamSplit: true } : {}),
    }),

  // 큐 순서 변경 (드래그앤드롭/▲▼) — QUEUED 엔트리 id의 새 전체 순서
  reorderQueue: (boardId: string, entryIds: string[]) =>
    api.patch(`/game-boards/${boardId}/queue/reorder`, { entryIds }),

  // 큐 게임을 빈(EMPTY) 코트에 배정 → 게임 시작 (your_turn push)
  assignEntry: (boardId: string, entryId: string, courtId: string) =>
    api.post(`/game-boards/${boardId}/entries/${entryId}/assign`, { courtId }),

  // 코트에 잘못 배정한 게임을 다시 대기 큐로 되돌림(배정 취소, 기록 안 남김)
  unassignByCourt: (boardId: string, courtId: string) =>
    api.post(`/game-boards/${boardId}/courts/${courtId}/unassign`),

  // 모드2 자석판: 이름표 1개 위치(분수) 갱신 → 운영진 공유(소켓 전파). 드래그 릴리즈마다.
  updateLayout: (boardId: string, userId: string, x: number, y: number) =>
    api.patch(`/game-boards/${boardId}/layout`, { userId, x, y }),
};

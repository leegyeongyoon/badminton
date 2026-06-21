import {
  UserRole, CourtStatus, GameStatus, TurnStatus,
  SkillLevel, GameType, CourtGameType,
  SessionStatus, PlayerStatus,
  ClubMemberRole, ClubSessionStatus, GameBoardEntryStatus,
} from './enums';

export interface UserResponse {
  id: string;
  phone: string | null;
  name: string;
  role: UserRole;
  isGuest: boolean;
  createdAt: string;
  /** 급수 from the user's PlayerProfile; null when not yet set. */
  skillLevel?: string | null;
  /** 성별 ('M' | 'F') from the PlayerProfile; null when not set. */
  gender?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: UserResponse;
  tokens: AuthTokens;
}

export interface FacilityResponse {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  qrCodeData: string;
  courts: CourtResponse[];
  createdAt: string;
}

export interface FacilityListItem {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  courtCount: number;
  hasOpenSession: boolean;
  checkedInCount: number;
}

export interface FacilityPolicyResponse {
  id: string;
  facilityId: string;
  maxTurnsPerCourt: number;
  playersPerTurn: number;
  allowRequeue: boolean;
  noShowPenaltyMinutes: number;
  turnNotifyEnabled: boolean;
  gameDurationMinutes: number | null;
  gameWarningMinutes: number | null;
}

export interface CourtResponse {
  id: string;
  name: string;
  facilityId: string;
  status: CourtStatus;
  gameType: CourtGameType;
  playersRequired: number;
}

// --- Turn (순번/고깔) system ---

export interface TurnPlayerResponse {
  id: string;
  userId: string;
  userName: string;
}

export interface CourtTurnResponse {
  id: string;
  courtId: string;
  position: number;
  status: TurnStatus;
  gameType: CourtGameType;
  createdById: string;
  createdByName: string;
  players: TurnPlayerResponse[];
  game: GameResponse | null;
  clubSessionId: string | null;
  clubName: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeLimitAt: string | null;
}

export interface CourtDetailResponse {
  court: CourtResponse;
  turns: CourtTurnResponse[];
  maxTurns: number;
}

export interface GameResponse {
  id: string;
  turnId: string;
  courtId: string;
  status: GameStatus;
  players: GamePlayerResponse[];
  createdAt: string;
}

export interface GamePlayerResponse {
  id: string;
  userId: string;
  userName: string;
}

// --- Board ---

export interface ClubSessionInfo {
  clubSessionId: string;
  clubId: string;
  clubName: string;
}

export interface BoardCourtData {
  court: CourtResponse;
  turns: CourtTurnResponse[];
  maxTurns: number;
  clubSessionInfo: ClubSessionInfo | null;
}

export interface DisplayBoardResponse {
  facilityName: string;
  sessionStatus: SessionStatus | null;
  courts: DisplayCourtData[];
  updatedAt: string;
}

export interface DisplayCourtData {
  courtName: string;
  status: CourtStatus;
  currentPlayers: string[];
  turnsCount: number;
  maxTurns: number;
  timeLimitAt: string | null;
  turnPreviews: { position: number; players: string[]; status: TurnStatus }[];
}

// --- Club ---

export interface ClubResponse {
  id: string;
  name: string;
  inviteCode: string;
  homeFacilityId: string | null;
  memberCount: number;
  createdAt: string;
}

export interface ClubMemberResponse {
  userId: string;
  name: string;
  role: ClubMemberRole;
  skillLevel: SkillLevel | null;
  gender: string | null;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: PlayerStatus | null;
}

// 모임 채팅/건의 메시지. type=REQUEST 는 짝 요청(○○랑 같이 치고 싶어요)으로
// mentioned 에 지목한 모임원(이름) 목록이 들어간다. authorName/skillLevel 은
// 작성자 정보를 미리 해석해 클라이언트가 바로 칩을 그릴 수 있게 한다.
export interface ClubMessageResponse {
  id: string;
  clubId: string;
  userId: string;
  authorName: string;
  authorSkillLevel: SkillLevel | null;
  text: string;
  type: 'CHAT' | 'REQUEST';
  mentioned: { userId: string; name: string }[];
  createdAt: string;
}

export interface ClubSessionResponse {
  id: string;
  clubId: string;
  clubName: string;
  facilityId: string;
  facilityName: string;
  facilitySessionId: string;
  startedById: string;
  startedByName: string;
  status: ClubSessionStatus;
  courtIds: string[];
  startedAt: string;
  endedAt: string | null;
}

// --- Per-정모 QR (모임 전용 QR) ---

/**
 * 출석 QR for a specific ClubSession (정모). The client renders `qr`; scanning it
 * with a phone camera opens the web app at the URL in `payload`
 * (`<WEB_BASE_URL>/attend?session=<clubSessionId>`), which (after login if
 * needed) UNCONDITIONALLY checks the user in (no geofence — the QR at the venue
 * is the presence proof) and lands them on the live 현황 보드.
 */
export interface SessionQrResponse {
  clubSessionId: string;
  payload: string; // "<WEB_BASE_URL>/attend?session=<clubSessionId>" (scannable URL)
  qr: string; // PNG data URL ("data:image/png;base64,...")
}

// --- Check-in ---

export interface CheckInResponse {
  id: string;
  userId: string;
  facilityId: string;
  facilityName: string;
  checkedInAt: string;
}

// --- Player ---

export interface PlayerProfileResponse {
  userId: string;
  /** 급수; null when the user hasn't set one yet (미설정). */
  skillLevel: SkillLevel | null;
  preferredGameTypes: GameType[];
  gender: string | null;
  birthYear: number | null;
  gamesPlayed: number;
  noShowCount: number;
}

export interface PlayerStatsResponse {
  gamesPlayed: number;
  gamesCompleted: number;
  gamesPlayedToday: number;
  noShowCount: number;
  activePenalty: NoShowRecordResponse | null;
}

export interface NoShowRecordResponse {
  id: string;
  userId: string;
  gameId: string;
  facilityId: string;
  occurredAt: string;
  penaltyEndsAt: string | null;
}

// --- My Turn ---

export interface MyTurnResponse {
  turnId: string;
  courtName: string;
  position: number;
  status: TurnStatus;
  players: TurnPlayerResponse[];
}

/**
 * Board-aware "my upcoming game" status for the current user (GET /users/me/status).
 * Derived from the active 정모's GameBoard + CourtTurns so a court-less QUEUED
 * board entry surfaces as a real "다음 게임 · 대기 N번째" state instead of a flat
 * "대기 중". null = the user is not checked into any active 정모.
 *   - PLAYING  : on a court right now.
 *   - QUEUED   : composed into the next game (court-less board entry OR a WAITING
 *                turn already materialized onto a court).
 *   - AVAILABLE: checked in but not yet composed into a game.
 */
export interface MyStatusResponse {
  status: 'PLAYING' | 'QUEUED' | 'AVAILABLE';
  clubSessionId: string;
  /** 1-based 대기 순번 (QUEUED) / 코트 순번 (on-court WAITING). */
  queueOrder: number | null;
  /** 코트 이름 (PLAYING / on-court WAITING). null = 코트 미정. */
  courtName: string | null;
  /** 내 앞에 남은 게임 수 (대략적 ETA). */
  etaGames: number | null;
  turnId: string | null;
}

// --- Session ---

export interface FacilitySessionResponse {
  id: string;
  facilityId: string;
  openedById: string;
  openedByName: string;
  status: SessionStatus;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
}

// --- Game History ---

export interface GameHistoryResponse {
  gameId: string;
  courtName: string;
  status: GameStatus;
  players: string[];
  playedAt: string;
}

// --- Notification ---

export interface NotificationResponse {
  id: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  read: boolean;
  createdAt: string;
}

// --- Available Players (대기석) ---

export interface AvailablePlayerResponse {
  userId: string;
  userName: string;
  /** 급수; null when not set (미설정). */
  skillLevel: SkillLevel | null;
  preferredGameTypes: GameType[];
  gender: string | null;
  checkedInAt: string;
  gamesPlayedToday: number;
  status: PlayerStatus;
  isGuest: boolean;
}

// --- Attendance leaderboard (출석왕) ---

export type AttendancePeriod = 'month' | 'year' | 'all';

export interface AttendanceLeaderboardEntry {
  userId: string;
  name: string;
  /** 급수; null when not set (미설정). */
  skillLevel: SkillLevel | null;
  attendanceCount: number;
  rank: number;
}

export interface AttendanceLeaderboardResponse {
  period: AttendancePeriod;
  entries: AttendanceLeaderboardEntry[];
  me: AttendanceLeaderboardEntry | null;
}

// --- Guests (게스트) ---

export interface GuestCheckInResponse {
  id: string;
  userId: string;
  facilityId: string;
  clubSessionId: string | null;
  facilityName: string;
  feeAmount: number | null;
  feePaid: boolean;
  checkedInAt: string;
}

export interface AddGuestResponse {
  guest: UserResponse;
  checkIn: GuestCheckInResponse;
}

export interface GuestSelfCheckInResponse {
  user: UserResponse;
  token: string;
  checkIn: GuestCheckInResponse;
}

/**
 * A single ACTIVE ClubSession (정모) at a facility, returned by the public
 * GET /checkin/active-sessions endpoint so an (unauthenticated) guest or a
 * member can pick which 정모 they're attending when more than one is active.
 */
export interface ActiveClubSessionItem {
  clubSessionId: string;
  clubName: string;
  facilityName: string;
  startedAt: string;
  scheduledStartAt?: string | null;
  title?: string | null;
}

// --- Guest fee settlement (게스트비) ---

export interface GuestFeeItem {
  checkInId: string;
  userId: string;
  guestName: string;
  feeAmount: number | null;
  feePaid: boolean;
}

export interface GuestFeeSettlementResponse {
  clubSessionId: string;
  items: GuestFeeItem[];
  totals: {
    totalFee: number;
    paidFee: number;
    unpaidFee: number;
    guestCount: number;
  };
}

export interface FacilityCapacityResponse {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
  totalTurnSlots: number;
  usedTurnSlots: number;
}

// --- Game Board (모임판) ---

export interface GameBoardResponse {
  id: string;
  clubSessionId: string;
  facilityId: string;
  createdById: string;
  createdAt: string;
  entries: GameBoardEntryResponse[];
  // SOFT double-booking flags: userIds who are currently PLAYING/IN_TURN
  // or appear in more than one QUEUED entry. The client renders these red.
  busyPlayerIds: string[];
  // Composition-aid data derived from THIS session's games (COMPLETED + currently
  // PLAYING + QUEUED entries' playerIds). Lets the client flag repeat foursomes
  // ("이미 친 조합") and over-paired players when staging the next game.
  //
  // playedGroups: each = a sorted-and-joined key ("a|b|c|d") of a 4-player group
  // that has ALREADY occurred (completed/playing game) this session.
  playedGroups: string[];
  // pairCounts: key = "<minUserId>|<maxUserId>", value = how many games this
  // session those two players shared. Only pairs with count >= 1 are included.
  pairCounts: Record<string, number>;
}

export interface GameBoardEntryResponse {
  id: string;
  boardId: string;
  courtId: string | null; // null while QUEUED (not yet assigned to a court)
  courtName: string;
  position: number;
  queueOrder: number; // global order within the court-less queue (다음 게임 순서)
  note: string | null;
  playerIds: string[];
  playerNames: string[];
  status: GameBoardEntryStatus;
  turnId: string | null;
  createdAt: string;
}

// --- Player matchups within a 정모 (선수 매치업) ---

export interface MatchupPartner {
  userId: string;
  name: string;
  skillLevel: SkillLevel | null;
  gender: string | null;
  count: number; // number of games shared with the target user this session
}

export interface PlayerMatchupsResponse {
  userId: string;
  totalGames: number; // games the target user played in this 정모
  partners: MatchupPartner[]; // everyone who shared a game, sorted by count desc
}

// --- 정모 종료 요약 리포트 (Club session summary) ---

export interface SessionSummaryMember {
  userId: string;
  name: string;
  gamesPlayed: number;
}

export interface SessionSummaryGuest {
  userId: string;
  name: string;
  gamesPlayed: number;
  feeAmount: number | null;
  feePaid: boolean;
}

export interface SessionSummaryPerPlayer {
  userId: string;
  name: string;
  count: number;
}

export interface ClubSessionSummaryResponse {
  session: {
    title: string | null;
    startedAt: string;
    endedAt: string | null;
    status: ClubSessionStatus;
  };
  attendance: {
    memberCount: number;
    guestCount: number;
    total: number;
    members: SessionSummaryMember[];
    guests: SessionSummaryGuest[];
  };
  games: {
    total: number;
    perPlayer: SessionSummaryPerPlayer[];
  };
  guestFees: {
    totalFee: number;
    paidFee: number;
    unpaidFee: number;
    guestCount: number;
  };
}

// Socket Events
export interface ServerToClientEvents {
  'court:statusChanged': (data: { courtId: string; status: CourtStatus }) => void;
  'turn:created': (data: CourtTurnResponse) => void;
  'turn:promoted': (data: { courtId: string; turns: CourtTurnResponse[] }) => void;
  'turn:started': (data: { courtId: string; turnId: string }) => void;
  'turn:completed': (data: { courtId: string; turnId: string }) => void;
  'turn:cancelled': (data: { courtId: string; turnId: string }) => void;
  'turn:requeued': (data: CourtTurnResponse) => void;
  'game:started': (data: GameResponse) => void;
  'game:completed': (data: GameResponse) => void;
  'checkin:arrived': (data: { userId: string; userName: string; facilityId: string }) => void;
  'checkin:left': (data: { userId: string; facilityId: string }) => void;
  'session:opened': (data: { facilityId: string; sessionId: string }) => void;
  'session:closed': (data: { facilityId: string }) => void;
  'display:updated': (data: DisplayBoardResponse) => void;
  'players:updated': (data: { facilityId: string; availableCount: number; inTurnCount: number; restingCount: number }) => void;
  'game:timeWarning': (data: { courtId: string; turnId: string; remainingSeconds: number }) => void;
  'game:timeExpired': (data: { courtId: string; turnId: string }) => void;
  'clubSession:started': (data: ClubSessionResponse) => void;
  'clubSession:courtsUpdated': (data: ClubSessionResponse) => void;
  'clubSession:ended': (data: { clubSessionId: string; clubId: string }) => void;
  'gameBoard:entryAdded': (data: GameBoardEntryResponse) => void;
  'gameBoard:entryUpdated': (data: GameBoardEntryResponse) => void;
  'gameBoard:entryRemoved': (data: { entryId: string; boardId: string }) => void;
  'gameBoard:entryPushed': (data: GameBoardEntryResponse) => void;
  'gameBoard:reordered': (data: { boardId: string; entryIds: string[] }) => void;
  'clubMessage:new': (data: ClubMessageResponse) => void;
}

export interface ClientToServerEvents {
  'facility:join': (facilityId: string) => void;
  'facility:leave': (facilityId: string) => void;
  'court:join': (courtId: string) => void;
  'court:leave': (courtId: string) => void;
  'clubSession:join': (clubSessionId: string) => void;
  'clubSession:leave': (clubSessionId: string) => void;
  'club:join': (clubId: string) => void;
  'club:leave': (clubId: string) => void;
  'user:join': (userId: string) => void;
  'user:leave': (userId: string) => void;
}

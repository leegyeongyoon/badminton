import {
  UserRole, CourtStatus, GameStatus, TurnStatus,
  FacilityRequestStatus, SkillLevel, GameType, CourtGameType,
  SessionStatus, RecruitmentStatus, PlayerStatus, RotationStatus,
  ClubMemberRole, ClubSessionStatus,
} from './enums';

export interface UserResponse {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  createdAt: string;
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

// --- Facility Request ---

export interface FacilityRequestResponse {
  id: string;
  userId: string;
  userName: string;
  name: string;
  address: string;
  status: FacilityRequestStatus;
  reviewNote: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  createdAt: string;
  reviewedAt: string | null;
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
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: PlayerStatus | null;
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
  skillLevel: SkillLevel;
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
  skillLevel: SkillLevel;
  preferredGameTypes: GameType[];
  gender: string | null;
  checkedInAt: string;
  gamesPlayedToday: number;
  status: PlayerStatus;
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

// --- Group Recruitment (조 모집) ---

export interface RecruitmentMemberResponse {
  userId: string;
  userName: string;
  joinedAt: string;
}

export interface GroupRecruitmentResponse {
  id: string;
  facilityId: string;
  createdById: string;
  createdByName: string;
  gameType: CourtGameType;
  playersRequired: number;
  targetCourtId: string | null;
  targetCourtName: string | null;
  status: RecruitmentStatus;
  message: string | null;
  members: RecruitmentMemberResponse[];
  createdAt: string;
  expiresAt: string;
  registeredTurnId: string | null;
}

// --- Rotation (로테이션/게임 편성) ---

export interface RotationSlotResponse {
  id: string;
  round: number;
  courtIndex: number;
  courtId: string;
  courtName: string;
  playerIds: string[];
  playerNames: string[];
  turnId: string | null;
  materialized: boolean;
  completed: boolean;
}

export interface RotationPlayerResponse {
  userId: string;
  userName: string;
  gamesAssigned: number;
  gamesPlayed: number;
  sittingOut: number;
}

export interface RotationScheduleResponse {
  id: string;
  facilityId: string;
  sessionId: string;
  status: RotationStatus;
  totalRounds: number;
  currentRound: number;
  playerCount: number;
  courtCount: number;
  slots: RotationSlotResponse[];
  players: RotationPlayerResponse[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
  'recruitment:created': (data: GroupRecruitmentResponse) => void;
  'recruitment:playerJoined': (data: GroupRecruitmentResponse) => void;
  'recruitment:full': (data: GroupRecruitmentResponse) => void;
  'recruitment:registered': (data: GroupRecruitmentResponse) => void;
  'recruitment:cancelled': (data: GroupRecruitmentResponse) => void;
  'rotation:generated': (data: RotationScheduleResponse) => void;
  'rotation:started': (data: RotationScheduleResponse) => void;
  'rotation:roundAdvanced': (data: { scheduleId: string; currentRound: number }) => void;
  'rotation:completed': (data: { scheduleId: string }) => void;
  'rotation:cancelled': (data: { scheduleId: string }) => void;
  'clubSession:started': (data: ClubSessionResponse) => void;
  'clubSession:courtsUpdated': (data: ClubSessionResponse) => void;
  'clubSession:ended': (data: { clubSessionId: string; clubId: string }) => void;
}

export interface ClientToServerEvents {
  'facility:join': (facilityId: string) => void;
  'facility:leave': (facilityId: string) => void;
  'court:join': (courtId: string) => void;
  'court:leave': (courtId: string) => void;
  'user:join': (userId: string) => void;
  'user:leave': (userId: string) => void;
}

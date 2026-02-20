import {
  UserRole, CourtStatus, HoldStatus, GameStatus, CallStatus,
  HoldType, QueueStatus, AutoMatchStatus, SkillLevel, GameType, SessionStatus,
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
  qrCodeData: string;
  courts: CourtResponse[];
  createdAt: string;
}

export interface FacilityPolicyResponse {
  id: string;
  facilityId: string;
  slotsPerCourt: number;
  holdCreationMethod: string;
  callTimeoutSeconds: number;
  noShowPenaltyMinutes: number;
  maxNoShowsBeforeCancel: number;
  queueAcceptTimeoutSeconds: number;
  maxQueueSize: number;
}

export interface CourtResponse {
  id: string;
  name: string;
  facilityId: string;
  status: CourtStatus;
  currentHold?: HoldResponse | null;
}

export interface HoldResponse {
  id: string;
  courtId: string;
  clubId: string;
  clubName: string;
  createdById: string;
  createdByName: string;
  status: HoldStatus;
  games: GameResponse[];
  createdAt: string;
}

export interface GameResponse {
  id: string;
  holdId: string;
  order: number;
  status: GameStatus;
  players: GamePlayerResponse[];
  createdAt: string;
}

export interface GamePlayerResponse {
  id: string;
  userId: string;
  userName: string;
  callStatus: CallStatus;
}

export interface ClubResponse {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  createdAt: string;
}

export interface ClubMemberResponse {
  userId: string;
  name: string;
  isLeader: boolean;
  isCheckedIn: boolean;
}

export interface CheckInResponse {
  id: string;
  userId: string;
  facilityId: string;
  facilityName: string;
  checkedInAt: string;
}

export interface BoardCourtData {
  court: CourtResponse;
  currentGame: GameResponse | null;
  upcomingGames: GameResponse[];
  holdClubName: string | null;
  holdClubId: string | null;
  queueCount: number;
  slotsUsed: number;
  slotsTotal: number;
}

export interface QueueEntryResponse {
  holdId: string;
  clubId: string;
  clubName: string;
  position: number;
  status: HoldStatus;
  queuedAt: string | null;
  acceptDeadline: string | null;
}

export interface QueueResponse {
  courtId: string;
  courtName: string;
  activeHold: HoldResponse | null;
  queue: QueueEntryResponse[];
  totalInQueue: number;
}

export interface MyGameResponse {
  gameId: string;
  courtName: string;
  order: number;
  status: GameStatus;
  teammates: GamePlayerResponse[];
  myCallStatus: CallStatus;
}

// --- New V2 types ---

export interface QueueEntryResponseV2 {
  id: string;
  userId: string;
  userName: string;
  clubId: string | null;
  clubName: string | null;
  queueType: HoldType;
  position: number;
  status: QueueStatus;
  queuedAt: string;
  acceptDeadline: string | null;
}

export interface QueueResponseV2 {
  courtId: string;
  courtName: string;
  activeHold: HoldResponse | null;
  queue: QueueEntryResponseV2[];
  totalInQueue: number;
}

export interface AutoMatchEntryResponse {
  id: string;
  userId: string;
  userName: string;
  gameType: GameType;
  status: AutoMatchStatus;
  joinedAt: string;
}

export interface AutoMatchPoolResponse {
  facilityId: string;
  entries: AutoMatchEntryResponse[];
  totalWaiting: number;
}

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

export interface DisplayBoardResponse {
  facilityName: string;
  sessionStatus: SessionStatus | null;
  courts: DisplayCourtData[];
  updatedAt: string;
}

export interface DisplayCourtData {
  courtName: string;
  status: CourtStatus;
  holdType: HoldType | null;
  holderName: string | null;
  currentGameStatus: GameStatus | null;
  currentPlayers: string[];
  queueCount: number;
  queuePreview: string[];
}

export interface NotificationResponse {
  id: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  read: boolean;
  createdAt: string;
}

export interface GameHistoryResponse {
  gameId: string;
  courtName: string;
  status: GameStatus;
  players: string[];
  playedAt: string;
}

// Socket Events
export interface ServerToClientEvents {
  'court:statusChanged': (data: { courtId: string; status: CourtStatus }) => void;
  'hold:created': (data: HoldResponse) => void;
  'hold:released': (data: { holdId: string; courtId: string }) => void;
  'lineup:gameAdded': (data: GameResponse) => void;
  'lineup:gameRemoved': (data: { gameId: string; holdId: string }) => void;
  'lineup:reordered': (data: { holdId: string; games: GameResponse[] }) => void;
  'game:calling': (data: GameResponse) => void;
  'game:playerResponded': (data: { gameId: string; playerId: string; callStatus: CallStatus }) => void;
  'game:confirmed': (data: GameResponse) => void;
  'game:started': (data: GameResponse) => void;
  'game:completed': (data: GameResponse) => void;
  'game:playerReplaced': (data: { gameId: string; oldPlayerId: string; newPlayerId: string }) => void;
  'checkin:arrived': (data: { userId: string; userName: string; facilityId: string }) => void;
  'checkin:left': (data: { userId: string; facilityId: string }) => void;
  'notification:call': (data: { gameId: string; courtName: string; message: string }) => void;
  'queue:joined': (data: { courtId: string; clubName: string; position: number; totalInQueue: number }) => void;
  'queue:left': (data: { courtId: string; clubId: string; totalInQueue: number }) => void;
  'queue:offerSent': (data: { courtId: string; clubName: string; acceptDeadline: string }) => void;
  'queue:promoted': (data: { courtId: string; clubName: string; holdId: string }) => void;
  'queue:skipped': (data: { courtId: string; clubId: string }) => void;
  'automatch:matched': (data: { gameId: string; courtName: string; players: string[] }) => void;
  'automatch:poolUpdated': (data: { facilityId: string; totalWaiting: number }) => void;
  'queue:individualJoined': (data: { courtId: string; userName: string; position: number }) => void;
  'session:opened': (data: { facilityId: string; sessionId: string }) => void;
  'session:closed': (data: { facilityId: string }) => void;
  'display:updated': (data: DisplayBoardResponse) => void;
}

export interface ClientToServerEvents {
  'facility:join': (facilityId: string) => void;
  'facility:leave': (facilityId: string) => void;
  'court:join': (courtId: string) => void;
  'court:leave': (courtId: string) => void;
  'user:join': (userId: string) => void;
  'user:leave': (userId: string) => void;
}

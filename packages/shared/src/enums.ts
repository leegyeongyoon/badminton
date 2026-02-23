export enum UserRole {
  FACILITY_ADMIN = 'FACILITY_ADMIN',
  CLUB_LEADER = 'CLUB_LEADER',
  PLAYER = 'PLAYER',
}

export enum CourtStatus {
  EMPTY = 'EMPTY',
  IN_USE = 'IN_USE',
  MAINTENANCE = 'MAINTENANCE',
}

export enum GameStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TurnStatus {
  WAITING = 'WAITING',
  PLAYING = 'PLAYING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum FacilityRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum SkillLevel {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
  PRO = 'PRO',
}

export enum GameType {
  SINGLES = 'SINGLES',
  DOUBLES = 'DOUBLES',
  MIXED_DOUBLES = 'MIXED_DOUBLES',
}

export enum CourtGameType {
  DOUBLES = 'DOUBLES',
  LESSON = 'LESSON',
}

export enum RecruitmentStatus {
  RECRUITING = 'RECRUITING',
  FULL = 'FULL',
  REGISTERED = 'REGISTERED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum PlayerStatus {
  AVAILABLE = 'AVAILABLE',
  IN_TURN = 'IN_TURN',
  RESTING = 'RESTING',
}

export enum SessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum RotationStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ClubMemberRole {
  LEADER = 'LEADER',
  STAFF = 'STAFF',
  MEMBER = 'MEMBER',
}

export enum ClubSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

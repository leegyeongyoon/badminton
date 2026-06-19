-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FACILITY_ADMIN', 'CLUB_LEADER', 'PLAYER');

-- CreateEnum
CREATE TYPE "CourtStatus" AS ENUM ('EMPTY', 'IN_USE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TurnStatus" AS ENUM ('WAITING', 'PLAYING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FacilityRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('S', 'A', 'B', 'C', 'D', 'E', 'F');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('SINGLES', 'DOUBLES', 'MIXED_DOUBLES');

-- CreateEnum
CREATE TYPE "CourtGameType" AS ENUM ('DOUBLES', 'LESSON');

-- CreateEnum
CREATE TYPE "RecruitmentStatus" AS ENUM ('RECRUITING', 'FULL', 'REGISTERED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClubMemberRole" AS ENUM ('LEADER', 'STAFF', 'MEMBER');

-- CreateEnum
CREATE TYPE "ClubSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "GameBoardEntryStatus" AS ENUM ('QUEUED', 'MATERIALIZED', 'PLAYING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "expoPushToken" TEXT,
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'D',
    "preferredGameTypes" "GameType"[] DEFAULT ARRAY['DOUBLES']::"GameType"[],
    "gender" TEXT,
    "birthYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "qrCodeData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityPolicy" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "maxTurnsPerCourt" INTEGER NOT NULL DEFAULT 3,
    "playersPerTurn" INTEGER NOT NULL DEFAULT 4,
    "allowRequeue" BOOLEAN NOT NULL DEFAULT true,
    "noShowPenaltyMinutes" INTEGER NOT NULL DEFAULT 30,
    "turnNotifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gameDurationMinutes" INTEGER,
    "gameWarningMinutes" INTEGER DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "status" "CourtStatus" NOT NULL DEFAULT 'EMPTY',
    "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,

    CONSTRAINT "FacilityAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "restingAt" TIMESTAMP(3),

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "homeFacilityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "role" "ClubMemberRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtTurn" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "TurnStatus" NOT NULL DEFAULT 'WAITING',
    "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES',
    "createdById" TEXT NOT NULL,
    "clubSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeLimitAt" TIMESTAMP(3),

    CONSTRAINT "CourtTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnPlayer" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TurnPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoShowRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "penaltyEndsAt" TIMESTAMP(3),

    CONSTRAINT "NoShowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "FacilityRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "FacilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySession" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "FacilitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "executeAt" TIMESTAMP(3) NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupRecruitment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES',
    "playersRequired" INTEGER NOT NULL DEFAULT 4,
    "targetCourtId" TEXT,
    "status" "RecruitmentStatus" NOT NULL DEFAULT 'RECRUITING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "registeredTurnId" TEXT,

    CONSTRAINT "GroupRecruitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentMember" (
    "id" TEXT NOT NULL,
    "recruitmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationSchedule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "clubSessionId" TEXT,
    "status" "RotationStatus" NOT NULL DEFAULT 'DRAFT',
    "totalRounds" INTEGER NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "playerCount" INTEGER NOT NULL,
    "courtCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RotationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationSlot" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "courtIndex" INTEGER NOT NULL,
    "courtId" TEXT NOT NULL,
    "playerIds" TEXT[],
    "turnId" TEXT,
    "materialized" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RotationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPlayer" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gamesAssigned" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "sittingOut" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RotationPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameBoard" (
    "id" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameBoardEntry" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "courtId" TEXT,
    "position" INTEGER NOT NULL,
    "playerIds" TEXT[],
    "status" "GameBoardEntryStatus" NOT NULL DEFAULT 'QUEUED',
    "turnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBoardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubSession" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilitySessionId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "ClubSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "courtIds" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClubSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_qrCodeData_key" ON "Facility"("qrCodeData");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityPolicy_facilityId_key" ON "FacilityPolicy"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Court_facilityId_name_key" ON "Court"("facilityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityAdmin_userId_facilityId_key" ON "FacilityAdmin"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "CheckIn_userId_facilityId_idx" ON "CheckIn"("userId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Club_inviteCode_key" ON "Club"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMember_userId_clubId_key" ON "ClubMember"("userId", "clubId");

-- CreateIndex
CREATE INDEX "CourtTurn_courtId_position_idx" ON "CourtTurn"("courtId", "position");

-- CreateIndex
CREATE INDEX "CourtTurn_courtId_status_idx" ON "CourtTurn"("courtId", "status");

-- CreateIndex
CREATE INDEX "CourtTurn_clubSessionId_idx" ON "CourtTurn"("clubSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TurnPlayer_turnId_userId_key" ON "TurnPlayer"("turnId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_turnId_key" ON "Game"("turnId");

-- CreateIndex
CREATE INDEX "Game_courtId_idx" ON "Game"("courtId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePlayer_gameId_userId_key" ON "GamePlayer"("gameId", "userId");

-- CreateIndex
CREATE INDEX "NoShowRecord_userId_facilityId_idx" ON "NoShowRecord"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "NoShowRecord_userId_penaltyEndsAt_idx" ON "NoShowRecord"("userId", "penaltyEndsAt");

-- CreateIndex
CREATE INDEX "FacilityRequest_status_idx" ON "FacilityRequest"("status");

-- CreateIndex
CREATE INDEX "FacilitySession_facilityId_status_idx" ON "FacilitySession"("facilityId", "status");

-- CreateIndex
CREATE INDEX "ScheduledJob_executed_executeAt_idx" ON "ScheduledJob"("executed", "executeAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE UNIQUE INDEX "GroupRecruitment_registeredTurnId_key" ON "GroupRecruitment"("registeredTurnId");

-- CreateIndex
CREATE INDEX "GroupRecruitment_facilityId_status_idx" ON "GroupRecruitment"("facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentMember_recruitmentId_userId_key" ON "RecruitmentMember"("recruitmentId", "userId");

-- CreateIndex
CREATE INDEX "RotationSchedule_facilityId_status_idx" ON "RotationSchedule"("facilityId", "status");

-- CreateIndex
CREATE INDEX "RotationSchedule_clubSessionId_idx" ON "RotationSchedule"("clubSessionId");

-- CreateIndex
CREATE INDEX "RotationSlot_scheduleId_round_idx" ON "RotationSlot"("scheduleId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "RotationSlot_scheduleId_round_courtIndex_key" ON "RotationSlot"("scheduleId", "round", "courtIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlayer_scheduleId_userId_key" ON "RotationPlayer"("scheduleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameBoard_clubSessionId_key" ON "GameBoard"("clubSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameBoardEntry_turnId_key" ON "GameBoardEntry"("turnId");

-- CreateIndex
CREATE INDEX "GameBoardEntry_boardId_position_idx" ON "GameBoardEntry"("boardId", "position");

-- CreateIndex
CREATE INDEX "ClubSession_clubId_status_idx" ON "ClubSession"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClubSession_facilityId_status_idx" ON "ClubSession"("facilityId", "status");

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityPolicy" ADD CONSTRAINT "FacilityPolicy_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAdmin" ADD CONSTRAINT "FacilityAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAdmin" ADD CONSTRAINT "FacilityAdmin_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_homeFacilityId_fkey" FOREIGN KEY ("homeFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtTurn" ADD CONSTRAINT "CourtTurn_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtTurn" ADD CONSTRAINT "CourtTurn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtTurn" ADD CONSTRAINT "CourtTurn_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnPlayer" ADD CONSTRAINT "TurnPlayer_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "CourtTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnPlayer" ADD CONSTRAINT "TurnPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "CourtTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityRequest" ADD CONSTRAINT "FacilityRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityRequest" ADD CONSTRAINT "FacilityRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySession" ADD CONSTRAINT "FacilitySession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySession" ADD CONSTRAINT "FacilitySession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_targetCourtId_fkey" FOREIGN KEY ("targetCourtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_registeredTurnId_fkey" FOREIGN KEY ("registeredTurnId") REFERENCES "CourtTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentMember" ADD CONSTRAINT "RecruitmentMember_recruitmentId_fkey" FOREIGN KEY ("recruitmentId") REFERENCES "GroupRecruitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentMember" ADD CONSTRAINT "RecruitmentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FacilitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSlot" ADD CONSTRAINT "RotationSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RotationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSlot" ADD CONSTRAINT "RotationSlot_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlayer" ADD CONSTRAINT "RotationPlayer_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RotationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlayer" ADD CONSTRAINT "RotationPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "GameBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "CourtTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_facilitySessionId_fkey" FOREIGN KEY ("facilitySessionId") REFERENCES "FacilitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


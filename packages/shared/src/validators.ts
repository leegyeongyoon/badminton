import { z } from 'zod';
import { UserRole, SkillLevel, GameType, CourtGameType, RecruitmentStatus, ClubMemberRole } from './enums';

// Auth
export const registerSchema = z.object({
  phone: z.string().regex(/^01[0-9]{8,9}$/, '올바른 전화번호를 입력하세요'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다'),
  name: z.string().min(1, '이름을 입력하세요').max(20),
  role: z.nativeEnum(UserRole).optional().default(UserRole.PLAYER),
});

export const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

export const pushTokenSchema = z.object({
  token: z.string().startsWith('ExponentPushToken['),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요'),
  newPassword: z.string().min(6, '새 비밀번호는 6자 이상이어야 합니다'),
});

// Facility
export const createFacilitySchema = z.object({
  name: z.string().min(1).max(50),
  address: z.string().min(1).max(200),
  totalCourts: z.number().int().min(1).max(30).optional(),
});

export const updatePolicySchema = z.object({
  maxTurnsPerCourt: z.number().int().min(1).max(10).optional(),
  playersPerTurn: z.number().int().min(2).max(8).optional(),
  allowRequeue: z.boolean().optional(),
  noShowPenaltyMinutes: z.number().int().min(0).max(120).optional(),
  turnNotifyEnabled: z.boolean().optional(),
  gameDurationMinutes: z.number().int().min(1).max(60).optional().nullable(),
  gameWarningMinutes: z.number().int().min(1).max(10).optional().nullable(),
});

export const updateCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Court
export const createCourtSchema = z.object({
  name: z.string().min(1).max(20),
  gameType: z.nativeEnum(CourtGameType).optional(),
});

export const updateCourtSchema = z.object({
  gameType: z.nativeEnum(CourtGameType).optional(),
});

export const updateCourtStatusSchema = z.object({
  status: z.enum(['MAINTENANCE', 'EMPTY']),
});

// Check-in
export const checkInSchema = z.object({
  qrData: z.string().min(1),
});

// Club
export const createClubSchema = z.object({
  name: z.string().min(1).max(50),
});

export const joinClubSchema = z.object({
  inviteCode: z.string().length(8),
});

// Turn (순번)
export const registerTurnSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(2).max(8),
  gameType: z.nativeEnum(CourtGameType).optional(),
});

// Turn extend
export const extendTurnSchema = z.object({
  minutes: z.number().int().min(1).max(30),
});

// Requeue with options
export const requeueTurnSchema = z.object({
  newPlayerIds: z.array(z.string().uuid()).min(2).max(8).optional(),
  targetCourtId: z.string().uuid().optional(),
});

// Facility Request
export const createFacilityRequestSchema = z.object({
  name: z.string().min(1).max(50),
  address: z.string().min(1).max(200),
});

export const reviewFacilityRequestSchema = z.object({
  approved: z.boolean(),
  reviewNote: z.string().max(500).optional(),
});

// Player Profile
export const updateProfileSchema = z.object({
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  preferredGameTypes: z.array(z.nativeEnum(GameType)).min(1).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
  birthYear: z.number().int().min(1940).max(2020).optional().nullable(),
});

// Session
export const openSessionSchema = z.object({
  note: z.string().max(200).optional(),
});

// Group Recruitment (조 모집)
export const createRecruitmentSchema = z.object({
  gameType: z.nativeEnum(CourtGameType).optional().default(CourtGameType.DOUBLES),
  targetCourtId: z.string().uuid().optional(),
  message: z.string().max(100).optional(),
  initialMemberIds: z.array(z.string().uuid()).max(3).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type UpdateCoordinatesInput = z.infer<typeof updateCoordinatesSchema>;
export type CreateCourtInput = z.infer<typeof createCourtSchema>;
export type UpdateCourtInput = z.infer<typeof updateCourtSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type CreateClubInput = z.infer<typeof createClubSchema>;
export type JoinClubInput = z.infer<typeof joinClubSchema>;
export type RegisterTurnInput = z.infer<typeof registerTurnSchema>;
export type ExtendTurnInput = z.infer<typeof extendTurnSchema>;
export type RequeueTurnInput = z.infer<typeof requeueTurnSchema>;
export type CreateFacilityRequestInput = z.infer<typeof createFacilityRequestSchema>;
export type ReviewFacilityRequestInput = z.infer<typeof reviewFacilityRequestSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type OpenSessionInput = z.infer<typeof openSessionSchema>;
export type CreateRecruitmentInput = z.infer<typeof createRecruitmentSchema>;

// Rotation (게임 편성)
export const generateRotationSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(4).optional(),
  courtIds: z.array(z.string().uuid()).min(1).optional(),
  targetRounds: z.number().int().min(1).max(50).optional(),
  clubSessionId: z.string().uuid().optional(),
});

export type GenerateRotationInput = z.infer<typeof generateRotationSchema>;

// Club Session (모임 세션)
export const startClubSessionSchema = z.object({
  facilityId: z.string().uuid(),
  courtIds: z.array(z.string().uuid()).optional(),
});

export const updateClubSessionCourtsSchema = z.object({
  courtIds: z.array(z.string().uuid()).min(1),
});

export const bulkRegisterTurnsSchema = z.object({
  turns: z.array(z.object({
    courtId: z.string().uuid(),
    playerIds: z.array(z.string().uuid()).min(2).max(8),
    gameType: z.nativeEnum(CourtGameType).optional(),
  })).min(1).max(20),
});

export const updateMemberRoleSchema = z.object({
  role: z.nativeEnum(ClubMemberRole),
});

export type StartClubSessionInput = z.infer<typeof startClubSessionSchema>;
export type UpdateClubSessionCourtsInput = z.infer<typeof updateClubSessionCourtsSchema>;
export type BulkRegisterTurnsInput = z.infer<typeof bulkRegisterTurnsSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

import { z } from 'zod';
import { UserRole, HoldCreationMethod, SkillLevel, GameType } from './enums';

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

// Facility
export const createFacilitySchema = z.object({
  name: z.string().min(1).max(50),
  address: z.string().min(1).max(200),
  totalCourts: z.number().int().min(1).max(30).optional(),
});

export const updatePolicySchema = z.object({
  slotsPerCourt: z.number().int().min(1).max(10).optional(),
  holdCreationMethod: z.nativeEnum(HoldCreationMethod).optional(),
  callTimeoutSeconds: z.number().int().min(30).max(600).optional(),
  noShowPenaltyMinutes: z.number().int().min(0).max(120).optional(),
  maxNoShowsBeforeCancel: z.number().int().min(1).max(5).optional(),
  queueAcceptTimeoutSeconds: z.number().int().min(30).max(600).optional(),
  maxQueueSize: z.number().int().min(1).max(20).optional(),
});

// Court
export const createCourtSchema = z.object({
  name: z.string().min(1).max(20),
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

// Hold
export const createHoldSchema = z.object({
  clubId: z.string().uuid(),
});

// Game
export const createGameSchema = z.object({
  playerIds: z.array(z.string().uuid()).length(4, '게임은 4명이 필요합니다'),
});

export const respondGameSchema = z.object({
  accept: z.boolean(),
});

export const replacePlayerSchema = z.object({
  targetPlayerId: z.string().uuid(),
  replacementPlayerId: z.string().uuid(),
});

// Queue (legacy - clubId required)
export const joinQueueSchema = z.object({
  clubId: z.string().uuid(),
});

export const acceptQueueSchema = z.object({
  clubId: z.string().uuid(),
});

// Queue V2 - clubId optional (individual queue support)
export const joinQueueV2Schema = z.object({
  clubId: z.string().uuid().optional(),
});

export const acceptQueueV2Schema = z.object({
  clubId: z.string().uuid().optional(),
});

// Player Profile
export const updateProfileSchema = z.object({
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  preferredGameTypes: z.array(z.nativeEnum(GameType)).min(1).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
  birthYear: z.number().int().min(1940).max(2020).optional().nullable(),
});

// Auto-match
export const joinAutoMatchSchema = z.object({
  gameType: z.nativeEnum(GameType),
});

// Session
export const openSessionSchema = z.object({
  note: z.string().max(200).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type CreateCourtInput = z.infer<typeof createCourtSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type CreateClubInput = z.infer<typeof createClubSchema>;
export type JoinClubInput = z.infer<typeof joinClubSchema>;
export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type CreateGameInput = z.infer<typeof createGameSchema>;
export type RespondGameInput = z.infer<typeof respondGameSchema>;
export type ReplacePlayerInput = z.infer<typeof replacePlayerSchema>;
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;
export type AcceptQueueInput = z.infer<typeof acceptQueueSchema>;
export type JoinQueueV2Input = z.infer<typeof joinQueueV2Schema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type JoinAutoMatchInput = z.infer<typeof joinAutoMatchSchema>;
export type OpenSessionInput = z.infer<typeof openSessionSchema>;

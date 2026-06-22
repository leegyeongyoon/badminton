import { z } from 'zod';
import { UserRole, SkillLevel, GameType, CourtGameType, ClubMemberRole } from './enums';

// Auth
export const registerSchema = z.object({
  phone: z.string().regex(/^01[0-9]{8,9}$/, '올바른 전화번호를 입력하세요'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다'),
  name: z.string().min(1, '이름을 입력하세요').max(20),
  role: z.nativeEnum(UserRole).optional().default(UserRole.PLAYER),
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
});

export const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

// Kakao social login — SECURE server-side authorization-code flow.
//
// The shared Kakao app carries a client_secret that must NEVER ship in the
// web/mobile bundle, so the client does NOT exchange the code for a token
// itself. Instead it sends EITHER:
//   - { code, redirectUri }  — preferred. The client ran Kakao's authorize
//     step and got an authorization `code`; the server exchanges it (with the
//     secret) for a Kakao access token. `redirectUri` MUST be the exact same
//     value the client used to obtain the code (Kakao validates the match).
//   - { accessToken }        — kept for a future native Kakao SDK that yields a
//     Kakao access token directly; the server validates it as-is.
// Exactly one of the two shapes is required.
export const kakaoLoginSchema = z
  .object({
    code: z.string().min(1).optional(),
    redirectUri: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
  })
  .refine(
    (d) => (!!d.code && !!d.redirectUri) || !!d.accessToken,
    {
      message: 'code+redirectUri 또는 accessToken이 필요합니다',
      path: ['code'],
    },
  );

// New-user profile completion (신규 카카오 가입자 프로필 설정).
// Sets the User.name and upserts the caller's PlayerProfile (급수/성별).
// 이름은 필수, 급수·성별은 선택.
export const completeProfileSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요').max(20),
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
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

// Rename / update a court. `name` lets LEADER/STAFF rename a court (코트 이름 변경).
export const updateCourtSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  gameType: z.nativeEnum(CourtGameType).optional(),
});

// EMPTY = available/idle (사용 가능), MAINTENANCE = unavailable (못 쓰는 코트)
export const updateCourtStatusSchema = z.object({
  status: z.enum(['MAINTENANCE', 'EMPTY']),
});

// Check-in
// EITHER qrData (facility static QR) OR clubSessionId (scanned per-정모 MEETUP QR)
// identifies the target; at least one is required.
export const checkInSchema = z
  .object({
    qrData: z.string().min(1).optional(),
    clubSessionId: z.string().uuid().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .refine((d) => !!d.qrData || !!d.clubSessionId, {
    message: 'qrData 또는 clubSessionId가 필요합니다',
    path: ['qrData'],
  });

// Guest self web check-in (unauthenticated)
// Same rule: either qrData or clubSessionId identifies the target.
export const guestCheckInSchema = z
  .object({
    qrData: z.string().min(1).optional(),
    clubSessionId: z.string().uuid().optional(),
    name: z.string().min(1, '이름을 입력하세요').max(20),
    skillLevel: z.nativeEnum(SkillLevel).optional(),
    gender: z.enum(['M', 'F']).optional().nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .refine((d) => !!d.qrData || !!d.clubSessionId, {
    message: 'qrData 또는 clubSessionId가 필요합니다',
    path: ['qrData'],
  });

// Operator adds a guest to a club session (authenticated, LEADER/STAFF)
export const addGuestSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요').max(20),
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
  feeAmount: z.number().int().min(0).max(1000000).optional(),
});

// Update a (guest) check-in fee / settle payment
export const updateFeeSchema = z.object({
  feeAmount: z.number().int().min(0).max(1000000).optional(),
  feePaid: z.boolean().optional(),
});

// Operator generates N random sample guests for quick testing/demo (LEADER/STAFF).
// EPHEMERAL — same as normal guests, they vanish on 정모 종료. The server picks
// the random names / skill / gender, so the body is just a count (1–50).
export const bulkRandomGuestsSchema = z.object({
  count: z.number().int().min(1, '최소 1명').max(50, '최대 50명'),
});

export type GuestCheckInInput = z.infer<typeof guestCheckInSchema>;
export type AddGuestInput = z.infer<typeof addGuestSchema>;
export type UpdateFeeInput = z.infer<typeof updateFeeSchema>;
export type BulkRandomGuestsInput = z.infer<typeof bulkRandomGuestsSchema>;

// --- Managed members (운영자 관리 멤버) ---
// Operator bulk-registers PERSISTENT club members who don't use the app. Unlike
// session guests, these survive 정모 종료 and stay in the club roster.
export const managedMemberInputSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요').max(20),
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
});

export const bulkAddManagedMembersSchema = z.object({
  members: z.array(managedMemberInputSchema).min(1, '최소 1명').max(50, '최대 50명'),
});

export type ManagedMemberInput = z.infer<typeof managedMemberInputSchema>;
export type BulkAddManagedMembersInput = z.infer<typeof bulkAddManagedMembersSchema>;

// Attendance leaderboard period: current calendar month | current calendar year | all-time
export const attendancePeriodSchema = z.enum(['month', 'year', 'all']);
export type AttendancePeriodInput = z.infer<typeof attendancePeriodSchema>;

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type KakaoLoginInput = z.infer<typeof kakaoLoginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
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
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type OpenSessionInput = z.infer<typeof openSessionSchema>;

// Club Session (모임 세션)
// 정모 start: the operator registers how many courts THIS 정모 owns (코트 수).
// The server creates 코트 1 … 코트 N belonging ONLY to this 정모 (default 4).
export const startClubSessionSchema = z.object({
  facilityId: z.string().uuid(),
  courtCount: z.number().int().min(1).max(30).optional(),
});

export const updateClubSessionCourtsSchema = z.object({
  courtIds: z.array(z.string().uuid()),
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

// Leader/Staff edits a member's 급수 (skill level) and gender
export const updateMemberProfileSchema = z.object({
  skillLevel: z.nativeEnum(SkillLevel).optional(),
  gender: z.enum(['M', 'F']).optional().nullable(),
});

// Game Board auto-suggest (자동 편성 추천)
// mode: 매칭 전략 (운영자가 선택) — 5개 모드가 실력 격차 스펙트럼을 이룸
//       (비슷 → 중간 → 큰 격차):
//   fair        공정      — gamesPlayedToday 적은 사람 우선 + 파트너 중복 최소 (기본)
//   similar     비슷한 급수 — 급수 차이가 가장 작은 4인 (수준 맞춘 게임, 가장 좁은 폭)
//   balanced    균형 접전  — 2:2 팀 합이 비슷하도록 (중간 정도 격차의 팽팽한 접전)
//   competitive 빡센 게임  — 2강 2약 (상위 2인 + 하위 2인, 실력 격차 큰 도전)
//   fresh       새 조합    — 함께 친 적이 가장 적은 4인
export const suggestFoursomeSchema = z.object({
  courtId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(8).optional(),
  mode: z
    .enum(['fair', 'similar', 'balanced', 'competitive', 'fresh'])
    .optional(),
  // Player ids to EXCLUDE from the eligible pool, on top of the server-side
  // exclusions (currently playing / queued / resting / penalized). The client
  // sends the players it has STAGED in the next-game tray plus those already in
  // QUEUED upcoming games, so building game-after-game keeps using fresh people.
  exclude: z.array(z.string().uuid()).optional(),
});

// Game Board QUEUE (미리 짜두는 다음 게임 큐)
// Create a court-less QUEUED game appended to the end of the global queue.
// playerIds: 1~4 — the operator can draft a partial group (2~3) and add more
// while editing; not forced to a fixed 4.
export const createQueueGameSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(1).max(4),
  note: z.string().max(100).optional(),
});

// Reorder the global queue: full new order of QUEUED entry ids (drag-and-drop).
export const reorderQueueSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1),
});

// Assign a QUEUED entry to a court (materializes it to a CourtTurn/Game).
export const assignEntrySchema = z.object({
  courtId: z.string().uuid(),
});

// 모임 채팅/건의 — 메시지 전송. type=REQUEST 는 "짝 요청"(○○랑 같이 치고
// 싶어요 / 누구랑 짜주세요)으로 mentionedUserIds 에 지목한 모임원 id 를 담는다.
export const sendMessageSchema = z.object({
  text: z.string().min(1).max(500),
  type: z.enum(['CHAT', 'REQUEST']).optional(),
  mentionedUserIds: z.array(z.string().uuid()).max(8).optional(),
});

export type StartClubSessionInput = z.infer<typeof startClubSessionSchema>;
export type UpdateClubSessionCourtsInput = z.infer<typeof updateClubSessionCourtsSchema>;
export type BulkRegisterTurnsInput = z.infer<typeof bulkRegisterTurnsSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type UpdateMemberProfileInput = z.infer<typeof updateMemberProfileSchema>;
export type SuggestFoursomeInput = z.infer<typeof suggestFoursomeSchema>;
export type CreateQueueGameInput = z.infer<typeof createQueueGameSchema>;
export type ReorderQueueInput = z.infer<typeof reorderQueueSchema>;
export type AssignEntryInput = z.infer<typeof assignEntrySchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

import { Router, Request, Response, NextFunction } from 'express';
import {
  createClubSchema,
  updateClubSchema,
  joinClubSchema,
  updateMemberRoleSchema,
  updateMemberProfileSchema,
  attendancePeriodSchema,
  bulkAddManagedMembersSchema,
  duesPeriodSchema,
  setDuesSchema,
} from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { validate } from '../../middleware/validate';
import { BadRequestError } from '../../utils/errors';
import * as clubService from './club.service';

const router = Router();

// Parse the ?period query. Absent/empty defaults to 'all'. A present-but-invalid
// value (e.g. the removed 'season') is rejected with 400 rather than silently
// falling back, so clients get clear feedback that the period is unsupported.
function parsePeriod(raw: unknown) {
  if (raw === undefined || raw === '') return 'all' as const;
  const result = attendancePeriodSchema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestError('지원하지 않는 기간입니다 (month, year, all, 또는 YYYY-MM)');
  }
  return result.data;
}

// Parse the dues ?period query. Absent/empty → current month (server-side).
// A present-but-invalid value is rejected with 400 (format "YYYY-MM").
function parseDuesPeriod(raw: unknown): string {
  if (raw === undefined || raw === '') {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const result = duesPeriodSchema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestError('기간 형식이 올바르지 않습니다 (YYYY-MM)');
  }
  return result.data;
}

// POST /api/v1/clubs - create a 모임. Only operators may create clubs: a
// SUPER_ADMIN or a CLUB_LEADER (a PLAYER must first be approved via 운영자 신청).
// The creator becomes the new club's LEADER (see clubService.createClub).
router.post('/', authenticate, roleGuard('SUPER_ADMIN', 'CLUB_LEADER'), validate(createClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.createClub(req.user!.userId, req.body);
    res.status(201).json(club);
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clubs = await clubService.listMyClubs(req.user!.userId, req.user!.role);
    res.json(clubs);
  } catch (err) { next(err); }
});

// DELETE /api/v1/clubs/:id - HARD-delete a 모임 and ALL descendants. Auth in the
// service: SUPER_ADMIN (global role) OR LEADER/STAFF of the club; PLAYER → 403.
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.deleteClub(req.params.id as string, req.user!.userId, req.user!.role);
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/v1/clubs/:id - update a 모임's info (name / homeFacilityId /
// description). Auth in the service: the club's LEADER OR SUPER_ADMIN; STAFF or a
// regular member → 403. At least one field required (updateClubSchema).
router.patch('/:id', authenticate, validate(updateClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.updateClub(
      req.params.id as string,
      req.user!.userId,
      req.user!.role,
      req.body,
    );
    res.json(club);
  } catch (err) { next(err); }
});

// POST /api/v1/clubs/:id/invite-code/regenerate - issue a fresh unique invite
// code (LEADER or SUPER_ADMIN). The old code/QR/link is invalidated. Returns
// { inviteCode }.
router.post('/:id/invite-code/regenerate', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.regenerateInviteCode(
      req.params.id as string,
      req.user!.userId,
      req.user!.role,
    );
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/join', authenticate, validate(joinClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.joinClub(req.user!.userId, req.body.inviteCode);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/clubs/:id/invite-qr - club join QR (any member of the club).
// Returns { inviteCode, joinUrl: "<WEB_BASE_URL>/join?code=...", qr: data URL }.
router.get('/:id/invite-qr', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.getInviteQr(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id/members', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilityId = req.query.facilityId as string | undefined;
    const members = await clubService.getMembers(req.params.id as string, facilityId);
    res.json(members);
  } catch (err) { next(err); }
});

// POST /api/v1/clubs/:clubId/members/bulk - LEADER/STAFF bulk-registers PERSISTENT
// operator-managed members (no app login). Body { members: [{ name, skillLevel?,
// gender? }] } (1–50). Skips exact-duplicate managed names. Returns created members.
router.post('/:clubId/members/bulk', authenticate, validate(bulkAddManagedMembersSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.bulkAddManagedMembers(
      req.params.clubId as string,
      req.user!.userId,
      req.body.members,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/clubs/:clubId/attendance/leaderboard?period=month|year|all
router.get('/:clubId/attendance/leaderboard', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = parsePeriod(req.query.period);
    const result = await clubService.getAttendanceLeaderboard(
      req.params.clubId as string,
      period,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/clubs/:clubId/attendance/me?period=month|year|all
router.get('/:clubId/attendance/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = parsePeriod(req.query.period);
    const me = await clubService.getMyAttendance(
      req.params.clubId as string,
      period,
      req.user!.userId,
    );
    res.json(me);
  } catch (err) { next(err); }
});

// GET /api/v1/clubs/:clubId/members/:userId/attendance - the 정모s a member
// attended in THIS club (distinct ClubSession, most-recent first) + count. Auth
// in the service: the club's LEADER/STAFF, OR the user themselves.
router.get('/:clubId/members/:userId/attendance', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.getMemberAttendance(
      req.params.clubId as string,
      req.params.userId as string,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/v1/clubs/:clubId/members/:userId/attendance - 그 회원의 이 모임 정모
// 출석(CheckIn) 기록을 모두 삭제(출석왕 0). 멤버십 유지. Auth: LEADER/SUPER_ADMIN(service).
router.delete('/:clubId/members/:userId/attendance', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.clearMemberAttendance(
      req.params.clubId as string,
      req.params.userId as string,
      req.user!.userId,
      req.user!.role as string,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/clubs/:clubId/dues?period=YYYY-MM - per-member monthly dues +
// totals (LEADER/STAFF). Default period = current month (server-side).
router.get('/:clubId/dues', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = parseDuesPeriod(req.query.period);
    const result = await clubService.getDues(
      req.params.clubId as string,
      period,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/clubs/:clubId/dues - mark a member paid/unpaid for a period
// (LEADER/STAFF). Returns the refreshed settlement summary.
router.post('/:clubId/dues', authenticate, validate(setDuesSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.setDues(
      req.params.clubId as string,
      req.user!.userId,
      req.body,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/v1/clubs/:id/members/:userId/role
router.patch('/:id/members/:userId/role', authenticate, validate(updateMemberRoleSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.updateMemberRole(
      req.params.id as string,
      req.params.userId as string,
      req.body.role,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/v1/clubs/:clubId/members/:userId/profile - LEADER/STAFF assigns a member's 급수/성별
router.patch('/:clubId/members/:userId/profile', authenticate, validate(updateMemberProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.updateMemberProfile(
      req.params.clubId as string,
      req.params.userId as string,
      req.body,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/v1/clubs/:id/members/:userId - remove a member from the club
// (내보내기). Auth in the service: the club's LEADER OR SUPER_ADMIN. Guards there:
// can't remove self-as-LEADER, can't remove another LEADER, target must be a
// member. If the member is checked into an ACTIVE 정모 they're checked out +
// their turns/board entries cleaned first. Returns { success: true }.
router.delete('/:id/members/:userId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.removeMember(
      req.params.id as string,
      req.params.userId as string,
      req.user!.userId,
      req.user!.role,
    );
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

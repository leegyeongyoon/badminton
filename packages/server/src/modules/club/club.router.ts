import { Router, Request, Response, NextFunction } from 'express';
import {
  createClubSchema,
  joinClubSchema,
  updateMemberRoleSchema,
  updateMemberProfileSchema,
  attendancePeriodSchema,
  bulkAddManagedMembersSchema,
} from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
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
    throw new BadRequestError('지원하지 않는 기간입니다 (month, year, all)');
  }
  return result.data;
}

router.post('/', authenticate, validate(createClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.createClub(req.user!.userId, req.body);
    res.status(201).json(club);
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clubs = await clubService.listMyClubs(req.user!.userId);
    res.json(clubs);
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

export default router;

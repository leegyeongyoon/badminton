import { Router, Request, Response, NextFunction } from 'express';
import { checkInSchema, guestCheckInSchema, updateFeeSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rateLimit';
import * as checkinService from './checkin.service';
import { updateCheckInFee } from '../clubSession/clubSession.service';

const router = Router();

// Per-IP rate limit on the UNauthenticated guest self check-in to curb abuse
// (each call creates a guest user + check-in row).
const guestCheckInLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'checkin:guest' });

// GET /checkin/active-sessions?qrData=<facilityQr> - UNauthenticated lookup of
// ACTIVE ClubSessions (정모) at a facility so a guest/member can pick which one
// they're attending. Declared BEFORE any auth-protected route so it stays public.
router.get('/active-sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const qrData = req.query.qrData;
    if (typeof qrData !== 'string' || !qrData.trim()) {
      res.status(400).json({ error: 'qrData가 필요합니다' });
      return;
    }
    const result = await checkinService.getActiveSessionsForQr(qrData.trim());
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', authenticate, validate(checkInSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { qrData, clubSessionId, latitude, longitude } = req.body;
    const result = await checkinService.checkIn(req.user!.userId, {
      qrData,
      clubSessionId,
      latitude,
      longitude,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// POST /checkin/guest - UNauthenticated guest self web check-in
router.post('/guest', guestCheckInLimiter, validate(guestCheckInSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { qrData, clubSessionId, name, skillLevel, gender, latitude, longitude } = req.body;
    const result = await checkinService.guestCheckIn({
      qrData,
      clubSessionId,
      name,
      skillLevel,
      gender,
      latitude,
      longitude,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/checkout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.checkOut(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.getCheckInStatus(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /checkin/facility/:facilityId/users - get checked in users at a facility
router.get('/facility/:facilityId/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.getCheckedInUsers(req.params.facilityId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /checkins/:checkInId/fee - set/update a guest's fee or mark paid (LEADER/STAFF)
router.patch('/:checkInId/fee', authenticate, validate(updateFeeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await updateCheckInFee(
      req.params.checkInId as string,
      req.user!.userId,
      req.body,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /checkin/rest - toggle rest mode
router.post('/rest', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.setResting(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /checkin/available - return from rest
router.post('/available', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.setAvailable(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

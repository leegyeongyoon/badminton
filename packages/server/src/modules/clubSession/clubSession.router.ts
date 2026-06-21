import { Router, Request, Response, NextFunction } from 'express';
import {
  startClubSessionSchema,
  updateClubSessionCourtsSchema,
  bulkRegisterTurnsSchema,
  addGuestSchema,
  updateFeeSchema,
} from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as clubSessionService from './clubSession.service';
import { registerTurn } from '../turn/turn.service';
import { operatorCheckOut, attendViaQr } from '../checkin/checkin.service';

const router = Router();

// POST /api/v1/clubs/:clubId/sessions - start a club session
router.post(
  '/:clubId/sessions',
  authenticate,
  validate(startClubSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await clubSessionService.startSession(
        req.params.clubId as string,
        req.user!.userId,
        req.body,
      );
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/clubs/:clubId/sessions/active - get active club session
router.get(
  '/:clubId/sessions/active',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await clubSessionService.getActiveSession(
        req.params.clubId as string,
      );
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id - get a single club session
router.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await clubSessionService.getSession(req.params.id as string);
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/qr - per-정모 QR (payload "MEETUP:<id>" + PNG data URL).
// Auth: any member of the session's club (enforced in the service).
router.get(
  '/:id/qr',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.getSessionQr(
        req.params.id as string,
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/attend - UNCONDITIONAL QR check-in into a 정모
// (정모 출석 QR flow). Authenticated. INTENTIONALLY skips the geofence — the QR
// is shown at the venue, so scanning it is the presence proof. Idempotent:
// scanning when already checked in just returns the existing check-in.
router.post(
  '/:id/attend',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await attendViaQr(req.params.id as string, req.user!.userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/courts - the courts THIS 정모 owns (session.courtIds).
// Operator board / start picker uses this so each 정모 only sees its own courts.
router.get(
  '/:id/courts',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const courts = await clubSessionService.getSessionCourts(req.params.id as string);
      res.json(courts);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/facility-courts - THIS 정모's OWN courts for the
// 코트 관리 modal. Each 정모 manages only its own courts (코트1·2·3); other 모임s'
// courts are never visible. No cross-session locking / "다른 모임 사용 중".
router.get(
  '/:id/facility-courts',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const courts = await clubSessionService.getSessionCourts(req.params.id as string);
      res.json(courts);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/players - session-scoped available players
// (only THIS 정모's checked-in players). Operator pool uses this instead of the
// facility-wide /facilities/:id/players so other 모임s' players don't leak in.
router.get(
  '/:id/players',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { getAvailablePlayers } = await import('../checkin/checkin.service');
      const session = await clubSessionService.getSession(req.params.id as string);
      const players = await getAvailablePlayers(session.facilityId, req.params.id as string);
      res.json(players);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/club-sessions/:id/courts - update court assignments
router.patch(
  '/:id/courts',
  authenticate,
  validate(updateClubSessionCourtsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await clubSessionService.updateCourts(
        req.params.id as string,
        req.user!.userId,
        req.body.courtIds,
      );
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/courts/add - 코트 추가 (per-정모): creates a new
// court at this 정모's facility with an AUTO-GENERATED non-colliding name and adds
// it to THIS session's courtIds. No body. LEADER/STAFF (enforced in the service).
router.post(
  '/:id/courts/add',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.addSessionCourt(
        req.params.id as string,
        req.user!.userId,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/end - end a club session
router.post(
  '/:id/end',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await clubSessionService.endSession(
        req.params.id as string,
        req.user!.userId,
      );
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/guests - operator adds a guest (LEADER/STAFF)
router.post(
  '/:id/guests',
  authenticate,
  validate(addGuestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.addGuest(
        req.params.id as string,
        req.user!.userId,
        req.body,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/players/:userId/matchups - who :userId played
// with IN THIS 정모 + shared-game counts (any club member).
router.get(
  '/:id/players/:userId/matchups',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.getPlayerMatchups(
        req.params.id as string,
        req.params.userId as string,
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/summary - 정모 종료 요약 리포트 (any club member)
router.get(
  '/:id/summary',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.getSessionSummary(
        req.params.id as string,
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/club-sessions/:id/guest-fees - guest fee settlement view (LEADER/STAFF)
router.get(
  '/:id/guest-fees',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await clubSessionService.getGuestFees(
        req.params.id as string,
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/checkout/:userId - operator checks out a
// SPECIFIC player from this 정모 (LEADER/STAFF only; enforced in the service).
// Reuses the same cleanup as self-checkout. Returns the refreshed pool.
router.post(
  '/:id/checkout/:userId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await operatorCheckOut(
        req.params.id as string,
        req.params.userId as string,
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/club-sessions/:id/turns/bulk - bulk register turns
router.post(
  '/:id/turns/bulk',
  authenticate,
  validate(bulkRegisterTurnsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.params.id as string;
      const results = [];
      for (const entry of req.body.turns) {
        const turn = await registerTurn(
          entry.courtId,
          req.user!.userId,
          entry.playerIds,
          entry.gameType,
          sessionId,
        );
        results.push(turn);
      }
      res.status(201).json(results);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

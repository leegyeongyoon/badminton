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

import { Router, Request, Response, NextFunction } from 'express';
import {
  startClubSessionSchema,
  updateClubSessionCourtsSchema,
  bulkRegisterTurnsSchema,
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

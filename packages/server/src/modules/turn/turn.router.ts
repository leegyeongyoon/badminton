import { Router, Request, Response, NextFunction } from 'express';
import { registerTurnSchema, extendTurnSchema, requeueTurnSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as turnService from './turn.service';

const router = Router();

// POST /api/v1/courts/:courtId/turns - register a turn
router.post('/:courtId/turns', authenticate, validate(registerTurnSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turn = await turnService.registerTurn(
      req.params.courtId as string,
      req.user!.userId,
      req.body.playerIds,
      req.body.gameType,
    );
    res.status(201).json(turn);
  } catch (err) { next(err); }
});

// GET /api/v1/courts/:courtId/turns - get court turns
router.get('/:courtId/turns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await turnService.getCourtTurns(req.params.courtId as string);
    res.json(detail);
  } catch (err) { next(err); }
});

// POST /api/v1/turns/:turnId/complete - complete a turn
router.post('/:turnId/complete', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turn = await turnService.completeTurn(req.params.turnId as string, req.user!.userId);
    res.json(turn);
  } catch (err) { next(err); }
});

// POST /api/v1/turns/:turnId/cancel - cancel a turn
router.post('/:turnId/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turn = await turnService.cancelTurn(req.params.turnId as string, req.user!.userId);
    res.json(turn);
  } catch (err) { next(err); }
});

// POST /api/v1/turns/:turnId/requeue - requeue after completion
router.post('/:turnId/requeue', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    // Optionally validate requeue body if provided
    if (body.newPlayerIds || body.targetCourtId) {
      requeueTurnSchema.parse(body);
    }
    const turn = await turnService.requeueTurn(req.params.turnId as string, req.user!.userId, {
      newPlayerIds: body.newPlayerIds,
      targetCourtId: body.targetCourtId,
    });
    res.json(turn);
  } catch (err) { next(err); }
});

// POST /api/v1/turns/:turnId/extend - extend game time (admin only)
router.post('/:turnId/extend', authenticate, validate(extendTurnSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turn = await turnService.extendTurn(
      req.params.turnId as string,
      req.user!.userId,
      req.body.minutes,
    );
    res.json(turn);
  } catch (err) { next(err); }
});

export default router;

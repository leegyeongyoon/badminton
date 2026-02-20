import { Router, Request, Response, NextFunction } from 'express';
import { createHoldSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as holdService from './hold.service';
import * as gameService from '../game/game.service';
import { createGameSchema } from '@badminton/shared';

const router = Router();

// POST /api/v1/courts/:id/hold
router.post('/:id/hold', authenticate, validate(createHoldSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hold = await holdService.createHold(req.params.id, req.user!.userId, req.body.clubId);
    res.status(201).json(hold);
  } catch (err) { next(err); }
});

// GET /api/v1/courts/:id/hold
router.get('/:id/hold', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hold = await holdService.getHold(req.params.id);
    res.json(hold);
  } catch (err) { next(err); }
});

export default router;

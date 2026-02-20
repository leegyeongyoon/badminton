import { Router, Request, Response, NextFunction } from 'express';
import { createGameSchema, respondGameSchema, replacePlayerSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as gameService from './game.service';

const router = Router();

// These are mounted at /api/v1/games
router.post('/:id/call', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.callGame(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/respond', authenticate, validate(respondGameSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.respondToCall(req.params.id, req.user!.userId, req.body.accept);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/start', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.startGame(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/complete', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.completeGame(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/replace', authenticate, validate(replacePlayerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.replacePlayer(
      req.params.id,
      req.body.targetPlayerId,
      req.body.replacementPlayerId,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

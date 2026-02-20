import { Router, Request, Response, NextFunction } from 'express';
import { createGameSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as holdService from './hold.service';
import * as gameService from '../game/game.service';

const router = Router();

router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await holdService.releaseHold(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// Lineup endpoints on hold
router.post('/:id/games', authenticate, validate(createGameSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const game = await gameService.createGame(req.params.id, req.body.playerIds, req.user!.userId);
    res.status(201).json(game);
  } catch (err) { next(err); }
});

router.get('/:id/games', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const games = await gameService.getLineup(req.params.id);
    res.json(games);
  } catch (err) { next(err); }
});

export default router;

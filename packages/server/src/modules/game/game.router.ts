import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import * as gameService from './game.service';

const router = Router();

// GET /api/v1/games/history - game history
router.get('/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const history = await gameService.getGameHistory(req.user!.userId, page, limit);
    res.json(history);
  } catch (err) { next(err); }
});

export default router;

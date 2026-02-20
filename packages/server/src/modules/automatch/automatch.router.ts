import { Router, Request, Response, NextFunction } from 'express';
import { joinAutoMatchSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as automatchService from './automatch.service';

const router = Router();

// POST /facilities/:id/automatch/join
router.post('/:id/automatch/join', authenticate, validate(joinAutoMatchSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await automatchService.joinPool(req.user!.userId, req.params.id, req.body.gameType);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// DELETE /facilities/:id/automatch/leave
router.delete('/:id/automatch/leave', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await automatchService.leavePool(req.user!.userId, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /facilities/:id/automatch/pool
router.get('/:id/automatch/pool', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await automatchService.getPool(req.params.id);
    res.json(pool);
  } catch (err) { next(err); }
});

export default router;

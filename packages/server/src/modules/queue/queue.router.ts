import { Router, Request, Response, NextFunction } from 'express';
import { joinQueueV2Schema, acceptQueueV2Schema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as queueService from './queue.service';

const router = Router();

// POST /courts/:id/queue - join queue (individual or club)
router.post('/:id/queue', authenticate, validate(joinQueueV2Schema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await queueService.joinQueue(req.params.id, req.user!.userId, req.body.clubId);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// DELETE /courts/:id/queue - leave queue
router.delete('/:id/queue', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await queueService.leaveQueue(req.params.id, req.user!.userId, req.body.clubId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /courts/:id/queue - get queue
router.get('/:id/queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queue = await queueService.getQueue(req.params.id);
    res.json(queue);
  } catch (err) { next(err); }
});

// POST /courts/:id/queue/accept - accept queue offer
router.post('/:id/queue/accept', authenticate, validate(acceptQueueV2Schema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await queueService.acceptQueueOffer(req.params.id, req.user!.userId, req.body.clubId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

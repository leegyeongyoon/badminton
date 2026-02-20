import { Router, Request, Response, NextFunction } from 'express';
import { updateCourtStatusSchema, createHoldSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { validate } from '../../middleware/validate';
import * as courtService from './court.service';
import * as holdService from '../hold/hold.service';

const router = Router();

router.patch('/:id/status', authenticate, roleGuard('FACILITY_ADMIN'), validate(updateCourtStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await courtService.updateCourtStatus(req.params.id, req.body.status);
    res.json(court);
  } catch (err) { next(err); }
});

// Court-level hold endpoints
router.post('/:id/hold', authenticate, validate(createHoldSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hold = await holdService.createHold(req.params.id, req.user!.userId, req.body.clubId);
    res.status(201).json(hold);
  } catch (err) { next(err); }
});

router.get('/:id/hold', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hold = await holdService.getHold(req.params.id);
    res.json(hold);
  } catch (err) { next(err); }
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { updateCourtStatusSchema, updateCourtSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { validate } from '../../middleware/validate';
import * as courtService from './court.service';

const router = Router();

router.patch('/:id/status', authenticate, roleGuard('FACILITY_ADMIN'), validate(updateCourtStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await courtService.updateCourtStatus(req.params.id as string, req.body.status);
    res.json(court);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, roleGuard('FACILITY_ADMIN'), validate(updateCourtSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await courtService.updateCourt(req.params.id as string, req.body);
    res.json(court);
  } catch (err) { next(err); }
});

export default router;

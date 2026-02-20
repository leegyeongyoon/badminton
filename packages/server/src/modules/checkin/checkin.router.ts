import { Router, Request, Response, NextFunction } from 'express';
import { checkInSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as checkinService from './checkin.service';

const router = Router();

router.post('/', authenticate, validate(checkInSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.checkIn(req.user!.userId, req.body.qrData);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/checkout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.checkOut(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkinService.getCheckInStatus(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

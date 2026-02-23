import { Router, Request, Response, NextFunction } from 'express';
import { generateRotationSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as rotationService from './rotation.service';

const router = Router();

// POST /api/v1/facilities/:facilityId/rotation/generate
router.post('/:facilityId/rotation/generate', authenticate, validate(generateRotationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.generateRotationSchedule(
      req.params.facilityId as string,
      req.user!.userId,
      req.body,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/facilities/:facilityId/rotation/current
router.get('/:facilityId/rotation/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.getCurrentRotation(req.params.facilityId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/rotation/:scheduleId
router.get('/:scheduleId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.getRotationSchedule(req.params.scheduleId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/rotation/:scheduleId/start
router.post('/:scheduleId/start', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.startRotation(req.params.scheduleId as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/rotation/:scheduleId/cancel
router.post('/:scheduleId/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.cancelRotation(req.params.scheduleId as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/rotation/:scheduleId/regenerate
router.post('/:scheduleId/regenerate', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rotationService.regenerateRotation(req.params.scheduleId as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

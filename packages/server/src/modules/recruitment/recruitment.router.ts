import { Router, Request, Response, NextFunction } from 'express';
import { createRecruitmentSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as recruitmentService from './recruitment.service';

const router = Router();

// POST /api/v1/facilities/:facilityId/recruitments - create recruitment
router.post('/:facilityId/recruitments', authenticate, validate(createRecruitmentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.createRecruitment(
      req.params.facilityId as string,
      req.user!.userId,
      req.body,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/facilities/:facilityId/recruitments - list active recruitments
router.get('/:facilityId/recruitments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.listRecruitments(req.params.facilityId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/recruitments/:id/join - join recruitment
router.post('/:id/join', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.joinRecruitment(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/recruitments/:id/leave - leave recruitment
router.post('/:id/leave', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.leaveRecruitment(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/recruitments/:id/register - register turn from full recruitment
router.post('/:id/register', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.registerRecruitment(
      req.params.id as string,
      req.user!.userId,
      req.body.courtId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/v1/recruitments/:id - cancel recruitment
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.cancelRecruitment(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

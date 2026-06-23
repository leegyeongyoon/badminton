import { Router, Request, Response, NextFunction } from 'express';
import { operatorRequestCreateSchema, operatorRequestReviewSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { validate } from '../../middleware/validate';
import * as service from './operatorRequest.service';

const router = Router();

// PLAYER → 운영자 신청 생성
router.post(
  '/',
  authenticate,
  validate(operatorRequestCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.createRequest(req.user!.userId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// 본인의 최신 신청 + 현재 권한
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getMyRequest(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// SUPER_ADMIN — 신청 목록 (?status=pending)
router.get(
  '/',
  authenticate,
  roleGuard('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const result = await service.listRequests(status);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// SUPER_ADMIN — 승인/거절
router.post(
  '/:id/review',
  authenticate,
  roleGuard('SUPER_ADMIN'),
  validate(operatorRequestReviewSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.reviewRequest(req.params.id as string, req.user!.userId, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

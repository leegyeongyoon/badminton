import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';
import { ForbiddenError } from '../../utils/errors';
import * as penaltyService from './penalty.service';

const router = Router();

// GET /facilities/:id/penalties - admin only, list all NoShowRecords for facility
router.get('/facilities/:id/penalties', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilityId = req.params.id;
    const userId = req.user!.userId;

    // Check if user is facility admin
    const isAdmin = await prisma.facilityAdmin.findFirst({
      where: { facilityId, userId },
    });
    if (!isAdmin) throw new ForbiddenError('시설 관리자만 조회할 수 있습니다');

    const penalties = await penaltyService.getFacilityPenalties(facilityId);
    res.json(penalties);
  } catch (err) { next(err); }
});

export default router;

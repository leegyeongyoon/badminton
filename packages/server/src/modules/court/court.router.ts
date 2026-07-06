import { Router, Request, Response, NextFunction } from 'express';
import { updateCourtStatusSchema, updateCourtSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as courtService from './court.service';
import { prisma } from '../../utils/prisma';
import { NotFoundError } from '../../utils/errors';

const router = Router();

// PATCH /api/v1/courts/:id/status — mark court available (EMPTY) / unavailable (MAINTENANCE).
// Allowed for FACILITY_ADMIN of the court's facility OR any club LEADER/STAFF.
router.patch('/:id/status', authenticate, validate(updateCourtStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await prisma.court.findUnique({ where: { id: req.params.id as string } });
    if (!court) throw new NotFoundError('코트');
    await courtService.verifyCourtManager(req.user!.userId, court.facilityId);
    const updated = await courtService.updateCourtStatus(req.params.id as string, req.body.status);
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/v1/courts/:id — rename / change gameType.
// Allowed for FACILITY_ADMIN of the court's facility OR any club LEADER/STAFF.
router.patch('/:id', authenticate, validate(updateCourtSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await prisma.court.findUnique({ where: { id: req.params.id as string } });
    if (!court) throw new NotFoundError('코트');
    await courtService.verifyCourtManager(req.user!.userId, court.facilityId);
    const updated = await courtService.updateCourt(req.params.id as string, req.body);
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/v1/courts/:id/move-game — 진행 중인 게임을 다른 빈 코트로 이동.
// body: { targetCourtId }. 코트 관리 권한(LEADER/STAFF/시설관리자) 필요.
router.post('/:id/move-game', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetCourtId = String(req.body?.targetCourtId || '');
    if (!targetCourtId) throw new NotFoundError('대상 코트');
    const result = await courtService.moveCourtGame(req.params.id as string, targetCourtId, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/v1/courts/:id — remove a court (only if not in use and has no history).
// Allowed for FACILITY_ADMIN of the court's facility OR any club LEADER/STAFF.
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const court = await prisma.court.findUnique({ where: { id: req.params.id as string } });
    if (!court) throw new NotFoundError('코트');
    await courtService.verifyCourtManager(req.user!.userId, court.facilityId);
    const result = await courtService.deleteCourt(req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;

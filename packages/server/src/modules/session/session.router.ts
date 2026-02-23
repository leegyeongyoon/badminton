import { Router, Request, Response, NextFunction } from 'express';
import { openSessionSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../utils/prisma';
import { ForbiddenError, NotFoundError } from '../../utils/errors';
import * as sessionService from './session.service';

const router = Router();

// POST /facilities/:id/sessions/open - admin only, open a session
router.post('/facilities/:id/sessions/open', authenticate, validate(openSessionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilityId = req.params.id as string;
    const userId = req.user!.userId;

    // Check if user is facility admin
    const isAdmin = await prisma.facilityAdmin.findFirst({
      where: { facilityId, userId },
    });
    if (!isAdmin) throw new ForbiddenError('시설 관리자만 세션을 열 수 있습니다');

    const session = await sessionService.openSession(facilityId, userId, req.body.note);
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// POST /sessions/:id/close - admin only, close a session
router.post('/sessions/:id/close', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.userId;

    // Load session to check facility admin permission
    const session = await prisma.facilitySession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundError('세션');
    }

    const isAdmin = await prisma.facilityAdmin.findFirst({
      where: { facilityId: session.facilityId, userId },
    });
    if (!isAdmin) throw new ForbiddenError('시설 관리자만 세션을 종료할 수 있습니다');

    const result = await sessionService.closeSession(sessionId, userId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /facilities/:id/sessions/current - get current open session
router.get('/facilities/:id/sessions/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await sessionService.getCurrentSession(req.params.id as string);
    res.json(session);
  } catch (err) { next(err); }
});

export default router;

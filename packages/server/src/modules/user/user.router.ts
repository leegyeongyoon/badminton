import { Router, Request, Response, NextFunction } from 'express';
import { updateProfileSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as userService from './user.service';
import * as turnService from '../turn/turn.service';
import { getMyStatus } from '../clubSession/clubSession.service';
import { getLabProfile, promoteWaitlist } from '../lab/lab.service';
import { prisma } from '../../utils/prisma';

const router = Router();

// GET /users/me/summary - 크로스클럽 활동 요약(총게임·스트릭·파트너 랭킹·뱃지).
// 실험실에서 검증된 getLabProfile을 본인 데이터 한정으로 정식 노출.
router.get('/me/summary', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLabProfile(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

// GET /users/me/guest-applications - 내가 넣은 게스트 신청(다른 모임) 목록.
router.get('/me/guest-applications', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.guestApplication.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { club: { select: { name: true } } },
    });
    res.json(rows.map((r) => ({
      id: r.id,
      clubName: r.club.name,
      visitDate: r.visitDate,
      status: r.status,
      feeAmount: r.feeAmount,
      feePaid: r.feePaid,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

// DELETE /users/me/guest-applications/:id - 내 신청 취소(대기 중일 때만).
router.delete('/me/guest-applications/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await prisma.guestApplication.findUnique({ where: { id: String(req.params.id) } });
    if (!app || app.userId !== req.user!.userId) {
      res.status(404).json({ error: '신청을 찾을 수 없습니다' });
      return;
    }
    if (app.status !== 'PENDING' && app.status !== 'WAITLIST') {
      res.status(400).json({ error: '확정된 신청은 운영자에게 문의해 주세요' });
      return;
    }
    await prisma.guestApplication.update({ where: { id: app.id }, data: { status: 'CANCELLED' } });
    // 유효 신청(PENDING) 취소로 자리가 났으면 대기열 승격.
    if (app.status === 'PENDING') {
      await promoteWaitlist(app.clubId, app.visitDate).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /users/me/turns/current - get my active turns
router.get('/me/turns/current', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turns = await turnService.getMyTurns(req.user!.userId);
    res.json(turns);
  } catch (err) { next(err); }
});

// GET /users/me/status - board-aware "my upcoming game" (PLAYING/QUEUED/AVAILABLE)
// derived from the active 정모's board + turns. Powers 내 현황 / 홈 so a court-less
// QUEUED entry surfaces as "다음 게임 · 대기 N번째" instead of a flat "대기 중".
router.get('/me/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getMyStatus(req.user!.userId);
    res.json(status);
  } catch (err) { next(err); }
});

// GET /users/me/profile - get player profile
router.get('/me/profile', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await userService.getProfile(req.user!.userId);
    res.json(profile);
  } catch (err) { next(err); }
});

// PUT /users/me/profile - update player profile
router.put('/me/profile', authenticate, validate(updateProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await userService.updateProfile(req.user!.userId, req.body);
    res.json(profile);
  } catch (err) { next(err); }
});

// GET /users/me/stats/weekly - weekly game counts
router.get('/me/stats/weekly', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await userService.getWeeklyStats(req.user!.userId);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /users/me/stats/game-types - game type distribution
router.get('/me/stats/game-types', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await userService.getGameTypeDistribution(req.user!.userId);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /users/me/stats/total - total stats with consecutive days
router.get('/me/stats/total', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await userService.getTotalStats(req.user!.userId);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /users/me/stats - get player stats
router.get('/me/stats', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await userService.getStats(req.user!.userId);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /users/me/history - get game history (paginated)
router.get('/me/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const history = await userService.getHistory(req.user!.userId, page, limit);
    res.json(history);
  } catch (err) { next(err); }
});

// GET /users/me/penalties - get my no-show records
router.get('/me/penalties', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const penalties = await userService.getPenalties(req.user!.userId);
    res.json(penalties);
  } catch (err) { next(err); }
});

// GET /users/me/admin-facilities - get facilities where user is admin
router.get('/me/admin-facilities', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilities = await userService.getAdminFacilities(req.user!.userId);
    res.json(facilities);
  } catch (err) { next(err); }
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { ForbiddenError } from '../../utils/errors';
import { isSuperAdmin } from '../clubSession/clubSession.service';
import { getAdminMetrics, type Granularity } from './metrics.service';

const router = Router();

// 슈퍼관리자 전용 가드 — 토큰 role 이 아니라 DB(isSuperAdmin)로 확인해, 승격 직후
// (재로그인 전)에도 통하게 한다. (모임 관리 경로와 동일한 방침.)
async function superAdminOnly(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!(await isSuperAdmin(req.user!.userId))) {
      throw new ForbiddenError('최고관리자만 접근할 수 있습니다');
    }
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/admin/metrics?granularity=day|week|month&count=N
// 운영 지표(실시간 + 기간별 추이). 슈퍼관리자 전용.
router.get('/metrics', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const g = String(req.query.granularity || 'day');
    const granularity: Granularity = g === 'week' || g === 'month' ? g : 'day';
    const count = req.query.count ? Number(req.query.count) : undefined;
    const result = await getAdminMetrics(granularity, count && count > 0 ? count : undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

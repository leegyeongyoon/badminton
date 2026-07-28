import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { ForbiddenError } from '../../utils/errors';
import { isSuperAdmin } from '../clubSession/clubSession.service';
import { getLabProfile, getClubSettlement, markDuesPaid, unmarkDuesPaid, setDuesAccount, getDuesConfig, setDuesConfig, getClubSessions, setSessionRentalCost, getClubGuests, setGuestFeePaid, getGuestApplications, updateGuestApplication } from './lab.service';

const router = Router();

// 실험실은 아직 일반 노출 금지 — 전부 최고관리자(SUPER_ADMIN)만. DB로 확인해 승격 직후
// (재로그인 전)에도 통하게 한다. (admin.router 와 동일 방침.)
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

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// GET /api/v1/lab/me/profile — 최고관리자 본인 프로필(프로토타입).
router.get('/me/profile', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLabProfile(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/users/:id/profile — 임의 회원 프로필(설계/테스트용).
router.get('/users/:id/profile', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLabProfile(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/clubs/:clubId/settlement?period=YYYY-MM — 모임 정산 자동화.
router.get('/clubs/:clubId/settlement', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSettlement(String(req.params.clubId), period));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/lab/clubs/:clubId/dues-payment — 입금확인 원클릭(완납 처리).
router.post('/clubs/:clubId/dues-payment', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period, amount } = req.body as { userId?: string; period?: string; amount?: number };
    if (!userId || !period) throw new ForbiddenError('userId, period 필요');
    await markDuesPaid(String(req.params.clubId), userId, period, Number(amount) || 0, req.user!.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/lab/clubs/:clubId/dues-payment — 입금확인 취소.
router.delete('/clubs/:clubId/dues-payment', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period } = req.body as { userId?: string; period?: string };
    if (!userId || !period) throw new ForbiddenError('userId, period 필요');
    await unmarkDuesPaid(String(req.params.clubId), userId, period);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/clubs/:clubId/sessions?period=YYYY-MM — 정모 목록(대관비 엔빵용).
router.get('/clubs/:clubId/sessions', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSessions(String(req.params.clubId), period));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/lab/club-sessions/:id/rental-cost — 정모 대관비(엔빵 총액) 설정.
router.put('/club-sessions/:id/rental-cost', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cost } = req.body as { cost?: number | null };
    await setSessionRentalCost(String(req.params.id), cost != null && Number(cost) > 0 ? Number(cost) : null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/clubs/:clubId/guests?period=YYYY-MM — 게스트 목록(게스트비 납부 상태).
router.get('/clubs/:clubId/guests', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubGuests(String(req.params.clubId), period));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/clubs/:clubId/guest-applications — 게스트 사전 신청 목록.
router.get('/clubs/:clubId/guest-applications', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getGuestApplications(String(req.params.clubId)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/lab/guest-applications/:id — 신청 입금확인/상태 갱신.
router.put('/guest-applications/:id', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { feePaid, status } = req.body as { feePaid?: boolean; status?: string };
    await updateGuestApplication(String(req.params.id), { feePaid, status });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/lab/checkins/:id/fee-paid — 게스트비 납부 토글.
router.put('/checkins/:id/fee-paid', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paid } = req.body as { paid?: boolean };
    await setGuestFeePaid(String(req.params.id), !!paid);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lab/clubs/:clubId/dues-config — 회비·게스트비 설정 조회.
router.get('/clubs/:clubId/dues-config', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getDuesConfig(String(req.params.clubId)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/lab/clubs/:clubId/dues-config — 회비·게스트비 설정 저장.
router.put('/clubs/:clubId/dues-config', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setDuesConfig(String(req.params.clubId), req.body || {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/lab/clubs/:clubId/dues-account — 입금 안내 계좌 설정.
router.put('/clubs/:clubId/dues-account', authenticate, superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { info } = req.body as { info?: string | null };
    await setDuesAccount(String(req.params.clubId), info != null ? String(info) : null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';
import { verifyClubStaff } from '../clubSession/clubSession.service';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import {
  getClubSettlement,
  getDuesConfig,
  setDuesConfig,
  getClubGuests,
  setGuestFeePaid,
  getClubSessions,
  setSessionRentalCost,
  markDuesPaid,
  unmarkDuesPaid,
  getGuestApplications,
  updateGuestApplication,
} from '../lab/lab.service';

// ─────────────────────────────────────────────────────────────
// 모임 회비 관리(정식) — 실험실에서 검증된 로직(lab.service)을 모임 운영진
// (LEADER/STAFF) 권한으로 승격한 라우터. /clubs/:clubId/money/* 프리픽스로
// 기존 club.router 경로와 충돌 없이 마운트한다.
// ─────────────────────────────────────────────────────────────

const router = Router();

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 공통: LEADER/STAFF(또는 SUPER_ADMIN) 가드.
async function staffGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    await verifyClubStaff(String(req.params.clubId), req.user!.userId);
    next();
  } catch (err) {
    next(err);
  }
}

// GET /clubs/:clubId/money/settlement?period
router.get('/:clubId/money/settlement', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSettlement(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// GET/PUT /clubs/:clubId/money/config — 회비·게스트비 설정
router.get('/:clubId/money/config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getDuesConfig(String(req.params.clubId))); } catch (err) { next(err); }
});
router.put('/:clubId/money/config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setDuesConfig(String(req.params.clubId), req.body || {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/guests?period — 게스트 목록(게스트비)
router.get('/:clubId/money/guests', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubGuests(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/sessions?period — 정모 목록(대관비 엔빵)
router.get('/:clubId/money/sessions', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSessions(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/sessions/:sessionId/rental-cost — 소유권 확인 후 설정
router.put('/:clubId/money/sessions/:sessionId/rental-cost', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.clubSession.findUnique({
      where: { id: String(req.params.sessionId) },
      select: { clubId: true },
    });
    if (!session || session.clubId !== String(req.params.clubId)) throw new NotFoundError('정모');
    const { cost } = req.body as { cost?: number | null };
    await setSessionRentalCost(String(req.params.sessionId), cost != null && Number(cost) > 0 ? Number(cost) : null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST/DELETE /clubs/:clubId/money/dues-payment — 입금확인 원클릭
router.post('/:clubId/money/dues-payment', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period, amount } = req.body as { userId?: string; period?: string; amount?: number };
    if (!userId || !period) throw new BadRequestError('userId, period 필요');
    await markDuesPaid(String(req.params.clubId), userId, period, Number(amount) || 0, req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.delete('/:clubId/money/dues-payment', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period } = req.body as { userId?: string; period?: string };
    if (!userId || !period) throw new BadRequestError('userId, period 필요');
    await unmarkDuesPaid(String(req.params.clubId), userId, period);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/guest-applications — 사전 신청 목록
router.get('/:clubId/money/guest-applications', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getGuestApplications(String(req.params.clubId))); } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/guest-applications/:appId — 소유권 확인 후 갱신
router.put('/:clubId/money/guest-applications/:appId', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await prisma.guestApplication.findUnique({
      where: { id: String(req.params.appId) },
      select: { clubId: true },
    });
    if (!app || app.clubId !== String(req.params.clubId)) throw new NotFoundError('신청');
    const { feePaid, status } = req.body as { feePaid?: boolean; status?: string };
    await updateGuestApplication(String(req.params.appId), { feePaid, status });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/checkins/:checkInId/fee-paid — 소유권 확인 후 게스트비 납부 토글
router.put('/:clubId/money/checkins/:checkInId/fee-paid', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ci = await prisma.checkIn.findUnique({
      where: { id: String(req.params.checkInId) },
      select: { clubSession: { select: { clubId: true } } },
    });
    if (!ci || ci.clubSession?.clubId !== String(req.params.clubId)) throw new NotFoundError('체크인');
    const { paid } = req.body as { paid?: boolean };
    await setGuestFeePaid(String(req.params.checkInId), !!paid);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

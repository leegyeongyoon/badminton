import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { rateLimit } from '../../middleware/rateLimit';
import * as svc from './payment.service';

// ─────────────────────────────────────────────────────────────
// 결제·정산 — /payments/* (전부 인증, PAYMENTS_MOCK 게이트는 서비스에서)
//  카드: POST|GET /payments/methods, DELETE /payments/methods/:id,
//        PUT /payments/methods/:id/default
//  내역: GET /payments/history
//  운영(SUPER_ADMIN): POST /payments/run-billing(자동청구 실행),
//        POST /payments/settlements/close {period},
//        POST /payments/settlements/:payoutId/pay,
//        GET  /payments/platform-summary?period=
// ─────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

const cardLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'pay:card' });

router.post('/methods', cardLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cardNumber, expiry, birthOrBiz } = req.body ?? {};
    res.status(201).json(await svc.registerCard(req.user!.userId, { cardNumber, expiry, birthOrBiz }));
  } catch (err) { next(err); }
});

router.get('/methods', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listCards(req.user!.userId));
  } catch (err) { next(err); }
});

router.delete('/methods/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.deleteCard(req.user!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/methods/:id/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.setDefaultCard(req.user!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getMyPayments(req.user!.userId));
  } catch (err) { next(err); }
});

// ── 플랫폼 운영(최고관리자) ──
router.post('/run-billing', roleGuard('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period } = req.body ?? {};
    res.json(await svc.runMonthlyBilling(period));
  } catch (err) { next(err); }
});

router.post('/settlements/close', roleGuard('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period } = req.body ?? {};
    res.json(await svc.closeSettlement(period));
  } catch (err) { next(err); }
});

router.post('/settlements/:payoutId/pay', roleGuard('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.executePayout(String(req.params.payoutId)));
  } catch (err) { next(err); }
});

router.get('/platform-summary', roleGuard('SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getPlatformSummary(String(req.query.period || '') || undefined));
  } catch (err) { next(err); }
});

export default router;

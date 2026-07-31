import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import * as svc from './coach.service';
import { getCoachSettlement } from '../lab/lab.service';
import { getMyPayouts, setCoachBank } from '../payment/payment.service';

// ─────────────────────────────────────────────────────────────
// 코치 마켓 — /coaches/*
//  • GET  /coaches            공개 목록(?region=&q=) — 인증 코치 우선
//  • GET  /coaches/me         내 코치 프로필(없으면 null)          [인증]
//  • PUT  /coaches/me         내 코치 프로필 등록/수정(업서트)      [인증]
//  • GET  /coaches/:id        공개 상세(비활성은 본인만)
//  • PUT  /coaches/:id/certified {certified} 인증 뱃지            [SUPER_ADMIN]
// ─────────────────────────────────────────────────────────────

const router = Router();

/** 로그인 상태면 userId 추출(선택적) — 비활성 프로필 본인 열람용. */
function optionalUserId(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev-secret') as { userId?: string };
    return payload.userId ?? undefined;
  } catch {
    return undefined;
  }
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { region, q, regions } = req.query as { region?: string; q?: string; regions?: string };
    res.json(await svc.listCoaches({ region, q, regions: svc.parseRegionsParam(regions) }));
  } catch (err) { next(err); }
});

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getMyCoachProfile(req.user!.userId));
  } catch (err) { next(err); }
});

router.get('/me/lessons', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listMyCoachLessons(req.user!.userId));
  } catch (err) { next(err); }
});

router.get('/me/settlement', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getCoachSettlement(req.user!.userId));
  } catch (err) { next(err); }
});

router.get('/me/payouts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getMyPayouts(req.user!.userId));
  } catch (err) { next(err); }
});

router.put('/me/bank', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setCoachBank(req.user!.userId, req.body ?? {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/me/career', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getMyCareer(req.user!.userId));
  } catch (err) { next(err); }
});

router.put('/me/career', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entries } = req.body as { entries?: unknown };
    res.json(await svc.setMyCareer(req.user!.userId, (entries ?? []) as never));
  } catch (err) { next(err); }
});

router.put('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.upsertMyCoachProfile(req.user!.userId, req.body ?? {}));
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getCoach(String(req.params.id), optionalUserId(req)));
  } catch (err) { next(err); }
});

router.put(
  '/:id/certified',
  authenticate,
  roleGuard('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await svc.setCoachCertified(String(req.params.id), !!(req.body ?? {}).certified));
    } catch (err) { next(err); }
  },
);

export default router;

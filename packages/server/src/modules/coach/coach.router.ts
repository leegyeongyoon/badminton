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
    const { region, q, regions, skills, certified, maxPrice } = req.query as {
      region?: string; q?: string; regions?: string; skills?: string; certified?: string; maxPrice?: string;
    };
    res.json(
      await svc.listCoaches(
        {
          region,
          q,
          regions: svc.parseRegionsParam(regions),
          skillLevels: skills ? String(skills).split(',').map((v) => v.trim()) : null,
          certifiedOnly: certified === '1',
          maxPriceMonth: maxPrice ? Number(maxPrice) : null,
        },
        optionalUserId(req),
      ),
    );
  } catch (err) { next(err); }
});

// GET /coaches/bookmarks — 내가 찜한 코치
router.get('/bookmarks', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listCoachBookmarks(req.user!.userId));
  } catch (err) { next(err); }
});

// POST/DELETE /coaches/:id/bookmark — 코치 찜 토글
router.post('/:id/bookmark', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.setCoachBookmark(req.user!.userId, String(req.params.id), true);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.delete('/:id/bookmark', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.setCoachBookmark(req.user!.userId, String(req.params.id), false);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /coaches/:id/reviews — 후기 목록+평균(+뷰어 자격·내 후기)
router.get('/:id/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listCoachReviews(String(req.params.id), optionalUserId(req)));
  } catch (err) { next(err); }
});

// PUT /coaches/:id/reviews — 후기 작성/수정(자격자만, 1인 1개)
router.put('/:id/reviews', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.upsertCoachReview(String(req.params.id), req.user!.userId, (req.body ?? {}) as { rating?: unknown; text?: unknown });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /coaches/:id/reviews — 내 후기 삭제
router.delete('/:id/reviews', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.deleteCoachReview(String(req.params.id), req.user!.userId);
    res.json({ ok: true });
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

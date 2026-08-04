import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import * as svc from './coachJob.service';

// ─────────────────────────────────────────────────────────────
// 코치 구인 공고 — /coach-jobs/*
//  • GET  /coach-jobs               공개 피드(?region=&q=)
//  • GET  /coach-jobs/mine          내 공고(+신규 지원 수)              [인증]
//  • GET  /coach-jobs/applied       내 지원(코치, 상태 포함)            [인증]
//  • POST /coach-jobs               작성(클럽 명의는 운영진만)          [인증]
//  • GET  /coach-jobs/:id           상세(관리자=지원자 목록, 코치=내 상태)
//  • PUT  /coach-jobs/:id           수정·마감                          [작성측]
//  • DELETE /coach-jobs/:id                                            [작성측]
//  • POST /coach-jobs/:id/apply     지원 {message}                     [코치]
//  • PUT  /coach-jobs/:id/applications/:appId {status}  상태 전이
// ─────────────────────────────────────────────────────────────

const router = Router();

const postLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'coachjob:post' });
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'coachjob:apply' });

/** 로그인 상태면 userId 추출(선택적) — 공개 상세에서 시점 분기용. */
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
    res.json(await svc.listJobs({ region, q, regions: svc.parseRegionsParam(regions) }));
  } catch (err) { next(err); }
});

router.get('/mine', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listMyJobs(req.user!.userId));
  } catch (err) { next(err); }
});

// POST /coach-jobs/scrape — 외부 공고 URL 에서 제목·요약 가져오기(작성 폼 자동 채움)
router.post('/scrape', authenticate, postLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.scrapeJobUrl((req.body as { url?: unknown } | undefined)?.url));
  } catch (err) { next(err); }
});

// GET /coach-jobs/invites — 내(코치)가 받은 공고 제안 목록
router.get('/invites', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listMyInvites(req.user!.userId));
  } catch (err) { next(err); }
});

// PUT /coach-jobs/invites/:inviteId/decline — 제안 거절(코치 본인)
router.put('/invites/:inviteId/decline', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.declineInvite(String(req.params.inviteId), req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /coach-jobs/:id/invite — 공고 제안 보내기(공고 관리자 → 코치)
router.post('/:id/invite', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { coachProfileId, message } = req.body as { coachProfileId?: string; message?: unknown };
    if (typeof coachProfileId !== 'string') {
      res.status(400).json({ error: 'coachProfileId가 필요합니다' });
      return;
    }
    res.json(await svc.inviteCoach(String(req.params.id), req.user!.userId, coachProfileId, message));
  } catch (err) { next(err); }
});

router.get('/applied', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listMyApplications(req.user!.userId));
  } catch (err) { next(err); }
});

router.post('/', authenticate, postLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await svc.createJob(req.user!.userId, req.body ?? {});
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.getJob(String(req.params.id), optionalUserId(req)));
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.updateJob(String(req.params.id), req.user!.userId, req.body ?? {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.deleteJob(String(req.params.id), req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/apply', authenticate, applyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body as { message?: string };
    res.status(201).json(await svc.applyJob(String(req.params.id), req.user!.userId, message));
  } catch (err) { next(err); }
});

router.put('/:id/applications/:appId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, offer, interview } = req.body as {
      status?: string; offer?: unknown;
      interview?: { when?: unknown; place?: unknown; note?: unknown } | null;
    };
    res.json(
      await svc.updateApplicationStatus(
        String(req.params.id),
        String(req.params.appId),
        req.user!.userId,
        String(status ?? ''),
        offer,
        interview,
      ),
    );
  } catch (err) { next(err); }
});

// PUT /coach-jobs/:id/applications/:appId/interview — 면접 안내 수정(공고측, INTERVIEW 단계)
router.put('/:id/applications/:appId/interview', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.setApplicationInterview(
      String(req.params.id),
      String(req.params.appId),
      req.user!.userId,
      (req.body ?? {}) as { when?: unknown; place?: unknown; note?: unknown },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /coach-jobs/:id/applications/:appId/note — 지원자 운영 메모(공고측 전용)
router.put('/:id/applications/:appId/note', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await svc.setApplicationNote(
      String(req.params.id),
      String(req.params.appId),
      req.user!.userId,
      (req.body as { note?: unknown } | undefined)?.note,
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

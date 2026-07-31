import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { BadRequestError } from '../../utils/errors';
import * as svc from './coachChat.service';

// ─────────────────────────────────────────────────────────────
// 코치 문의 채팅(인증) — /coach-chat/*
//  • POST /coach-chat/start          {coachProfileId, clubId?} → 스레드(find-or-create)
//  • GET  /coach-chat/threads        내 스레드 목록 {asUser, asCoach}
//  • GET  /coach-chat/unread-count   내 미읽음 총합(뱃지)
//  • GET  /coach-chat/:threadId      대화 로드(내 쪽 안 읽음 0)
//  • POST /coach-chat/:threadId/messages {text}
// ─────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

const msgLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'coachchat:msg' });

router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { coachProfileId, clubId } = req.body as { coachProfileId?: string; clubId?: string };
    if (!coachProfileId) throw new BadRequestError('coachProfileId 필요');
    res.status(201).json(await svc.startThread(req.user!.userId, coachProfileId, clubId ?? null));
  } catch (err) { next(err); }
});

router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.listMyThreads(req.user!.userId));
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ count: await svc.countMyUnread(req.user!.userId) });
  } catch (err) { next(err); }
});

router.get('/:threadId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.loadThread(String(req.params.threadId), req.user!.userId));
  } catch (err) { next(err); }
});

router.post('/:threadId/messages', msgLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body as { text?: string };
    res.status(201).json(await svc.sendMessage(String(req.params.threadId), req.user!.userId, String(text ?? '')));
  } catch (err) { next(err); }
});

export default router;

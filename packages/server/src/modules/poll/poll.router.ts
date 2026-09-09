import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import * as poll from './poll.service';

// ─────────────────────────────────────────────────────────────
// 정모 즉석 투표 — /club-sessions/:id/polls, /polls/:pollId/*
// 생성·마감·삭제는 운영진(verifyClubStaff), 투표는 체크인 회원.
// ─────────────────────────────────────────────────────────────

const router = Router();

// GET /club-sessions/:id/polls — 이 정모의 투표 목록
router.get('/club-sessions/:id/polls', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await poll.listPolls(String(req.params.id), req.user!.userId));
  } catch (err) { next(err); }
});

// POST /club-sessions/:id/polls — 투표 생성(운영진)
router.post('/club-sessions/:id/polls', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question, options, anonymous, multi, closesInMin } = req.body as {
      question?: string; options?: string[]; anonymous?: boolean; multi?: boolean; closesInMin?: number;
    };
    res.json(await poll.createPoll(String(req.params.id), req.user!.userId, { question, options, anonymous, multi, closesInMin }));
  } catch (err) { next(err); }
});

// GET /polls/:pollId — 단건 조회(실시간 갱신용)
router.get('/polls/:pollId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await poll.getPoll(String(req.params.pollId), req.user!.userId));
  } catch (err) { next(err); }
});

// POST /polls/:pollId/vote {optionIndex} — 투표(체크인 회원)
router.post('/polls/:pollId/vote', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { optionIndex } = req.body as { optionIndex?: number };
    res.json(await poll.vote(String(req.params.pollId), req.user!.userId, Number(optionIndex)));
  } catch (err) { next(err); }
});

// POST /polls/:pollId/close — 마감(운영진)
router.post('/polls/:pollId/close', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await poll.closePoll(String(req.params.pollId), req.user!.userId));
  } catch (err) { next(err); }
});

// DELETE /polls/:pollId — 삭제(운영진)
router.delete('/polls/:pollId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await poll.deletePoll(String(req.params.pollId), req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export { router as pollRouter };

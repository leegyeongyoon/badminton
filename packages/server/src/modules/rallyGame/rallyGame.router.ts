/**
 * 콕고 랠리 PvP — 대결 신청 REST.
 * POST /api/v1/rally/challenge            {toUserId}
 * POST /api/v1/rally/matches/:id/accept
 * POST /api/v1/rally/matches/:id/decline
 */
import { Router } from 'express';
import { rallyChallengeSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as rallyService from './rallyGame.service';

const router = Router();

router.post('/challenge', authenticate, validate(rallyChallengeSchema), async (req, res, next) => {
  try {
    res.json(await rallyService.challenge(req.user!.userId, req.body.toUserId));
  } catch (err) {
    next(err);
  }
});

router.post('/matches/:id/accept', authenticate, async (req, res, next) => {
  try {
    res.json(await rallyService.accept(req.params.id as string, req.user!.userId));
  } catch (err) {
    next(err);
  }
});

router.post('/matches/:id/decline', authenticate, async (req, res, next) => {
  try {
    res.json(await rallyService.decline(req.params.id as string, req.user!.userId));
  } catch (err) {
    next(err);
  }
});

// 호스트의 결과 보고 — 정모별 랠리왕 리더보드 재료
router.post('/matches/:id/result', authenticate, async (req, res, next) => {
  try {
    res.json(await rallyService.reportResult(req.params.id as string, req.user!.userId, req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

// 오늘 이 정모의 랠리왕 리더보드
router.get('/leaderboard/:clubSessionId', authenticate, async (req, res, next) => {
  try {
    res.json(await rallyService.leaderboard(req.params.clubSessionId as string));
  } catch (err) {
    next(err);
  }
});

export default router;

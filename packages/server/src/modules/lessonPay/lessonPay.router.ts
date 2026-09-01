import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../middleware/rateLimit';
import {
  getLessonPayPublicView,
  reportLessonFee,
  cancelLessonFeeReport,
  confirmLessonFeeByToken,
} from '../lab/lab.service';

// ─────────────────────────────────────────────────────────────
// 레슨비 무설치 납부 페이지(공개, 비인증) — /lesson-pay/*
//  • GET    /lesson-pay/:token                — 반 정보·당월·금액·계좌·명단+납부 상태
//  • POST   /lesson-pay/:token/report         — 수강생 "입금했어요" 신고(당월)
//  • POST   /lesson-pay/:token/report/cancel  — 신고 취소(실수 복구, REPORTED만)
//  • POST   /lesson-pay/:token/confirm        — 반장 확인(관리 토큰 전용)
//  • DELETE /lesson-pay/:token/confirm        — 반장 확인 해제(관리 토큰 전용)
// 토큰: publicToken(반원 공유용) / manageToken(반장 전용 — 개인 전달).
// 이체는 기존 계좌로 직접 하고, 여기서는 신고·확인 상태만 기록한다.
// ─────────────────────────────────────────────────────────────

const router = Router();
const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'lessonpay:view' });
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'lessonpay:report' });
const confirmLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyPrefix: 'lessonpay:confirm' });

router.get('/:token', viewLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLessonPayPublicView(String(req.params.token)));
  } catch (err) {
    next(err);
  }
});

router.post('/:token/report', reportLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId } = req.body as { applicationId?: string };
    res.json(await reportLessonFee(String(req.params.token), String(applicationId || '')));
  } catch (err) {
    next(err);
  }
});

router.post('/:token/report/cancel', reportLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId } = req.body as { applicationId?: string };
    await cancelLessonFeeReport(String(req.params.token), String(applicationId || ''));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:token/confirm', confirmLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId } = req.body as { applicationId?: string };
    await confirmLessonFeeByToken(String(req.params.token), String(applicationId || ''), true);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:token/confirm', confirmLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId } = req.body as { applicationId?: string };
    await confirmLessonFeeByToken(String(req.params.token), String(applicationId || ''), false);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export { router as lessonPayRouter };

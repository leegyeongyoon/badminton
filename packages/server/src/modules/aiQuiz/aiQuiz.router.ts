import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../middleware/rateLimit';
import { listQuizQuestions, saveQuizAnswer } from './aiQuiz.service';
import { QUIZ_HTML, QUIZ_JS } from './quizPage';

// ─────────────────────────────────────────────────────────────
// AI 편성 퀴즈(공개, 비인증 — 링크의 모임 키로 확인)
//  • GET  /ai-quiz?c=<모임 id>&k=<키>   — 퀴즈 화면
//  • GET  /ai-quiz/quiz.js              — 화면 스크립트(CSP script-src 'self')
//  • GET  /ai-quiz/questions?c=&k=      — 문제(운영진 판 vs 그 순간 AI 안)
//  • POST /ai-quiz/answers              — 답 저장(이름 + 고른 쪽 + 이유)
// ─────────────────────────────────────────────────────────────

const router = Router();
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'aiquiz:read' });
const answerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 300, keyPrefix: 'aiquiz:answer' });

router.get('/', (_req: Request, res: Response) => {
  res.type('html').set('Cache-Control', 'no-store').send(QUIZ_HTML);
});

router.get('/quiz.js', (_req: Request, res: Response) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(QUIZ_JS);
});

router.get('/questions', readLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.set('Cache-Control', 'no-store').json(await listQuizQuestions(req.query.c, req.query.k));
  } catch (err) {
    next(err);
  }
});

router.post('/answers', answerLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await saveQuizAnswer(req.body));
  } catch (err) {
    next(err);
  }
});

export default router;

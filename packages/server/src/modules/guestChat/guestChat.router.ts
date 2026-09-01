import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../middleware/rateLimit';
import { optionalUserId } from '../../middleware/optionalAuth';
import { BadRequestError } from '../../utils/errors';
import * as svc from './guestChat.service';

// ─────────────────────────────────────────────────────────────
// 게스트 문의 채팅(공개, 비인증) — /guest-chat/*
//  • POST /guest-chat/start            {clubId?|inviteCode?, name?} → 스레드(토큰=threadId)
//  • GET  /guest-chat/:threadId        스레드 대화 로드(게스트 안 읽음 0)
//  • POST /guest-chat/:threadId/messages {text, name?} → 게스트 메시지
// 로그인 상태면(Authorization) guestUserId를 연결해 기기 무관 지속 + 답장 푸시.
// ─────────────────────────────────────────────────────────────

const router = Router();
const startLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'guestchat:start' });
const msgLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'guestchat:msg' });

// optionalUserId는 공용 미들웨어로 추출됨 — src/middleware/optionalAuth.ts

router.post('/start', startLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clubId, inviteCode, name } = req.body as { clubId?: string; inviteCode?: string; name?: string };
    if (!clubId && !inviteCode) throw new BadRequestError('clubId 또는 inviteCode 필요');
    const view = await svc.startGuestThread({ clubId, inviteCode, guestUserId: optionalUserId(req), name });
    res.status(201).json(view);
  } catch (err) { next(err); }
});

router.get('/:threadId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await svc.loadThreadForGuest(String(req.params.threadId)));
  } catch (err) { next(err); }
});

router.post('/:threadId/messages', msgLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, name } = req.body as { text?: string; name?: string };
    const msg = await svc.guestSendMessage(String(req.params.threadId), String(text ?? ''), name);
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

export default router;

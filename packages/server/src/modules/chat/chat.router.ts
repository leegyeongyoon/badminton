import { Router, Request, Response, NextFunction } from 'express';
import { sendMessageSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as chatService from './chat.service';

const router = Router();

// POST /api/v1/clubs/:clubId/messages - 모임 채팅/건의 메시지 작성 (모임 멤버 only).
// body: { text, type?, mentionedUserIds? }. 비멤버 → 403.
router.post(
  '/:clubId/messages',
  authenticate,
  validate(sendMessageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const message = await chatService.createMessage(
        req.params.clubId as string,
        req.user!.userId,
        req.body,
      );
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/clubs/:clubId/messages?before=<iso>&limit=<=50 - 최근 메시지(오름차순).
// 모임 멤버 only. 비멤버 → 403.
router.get(
  '/:clubId/messages',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitRaw = req.query.limit as string | undefined;
      const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
      const messages = await chatService.listMessages(
        req.params.clubId as string,
        req.user!.userId,
        {
          before: req.query.before as string | undefined,
          limit: Number.isNaN(limit as number) ? undefined : limit,
        },
      );
      res.json(messages);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';
import { NotFoundError } from '../../utils/errors';
import type { NotificationResponse } from '@badminton/shared';

const router = Router();

// GET /notifications - list user's notifications (newest first, paginated)
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const result: NotificationResponse[] = notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      data: n.data as Record<string, any> | null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read - mark single notification as read
router.patch('/:id/read', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const notificationId = req.params.id as string;

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundError('알림');
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /notifications/read-all - mark all notifications as read
router.patch('/read-all', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;

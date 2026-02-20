import { Router, Request, Response, NextFunction } from 'express';
import { updateProfileSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../utils/prisma';
import * as userService from './user.service';

const router = Router();

// GET /users/me/games/current - get my current active game
router.get('/me/games/current', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const activeGamePlayer = await prisma.gamePlayer.findFirst({
      where: {
        userId,
        game: {
          status: { in: ['WAITING', 'CALLING', 'CONFIRMED', 'IN_PROGRESS'] },
          hold: {
            status: 'ACTIVE',
          },
        },
      },
      include: {
        game: {
          include: {
            players: { include: { user: true } },
            hold: {
              include: {
                court: true,
              },
            },
          },
        },
      },
      orderBy: {
        game: { order: 'asc' },
      },
    });

    if (!activeGamePlayer) {
      res.json(null);
      return;
    }

    const game = activeGamePlayer.game;
    res.json({
      gameId: game.id,
      courtName: game.hold.court.name,
      order: game.order,
      status: game.status,
      teammates: game.players.map((p) => ({
        id: p.id,
        userId: p.userId,
        userName: p.user.name,
        callStatus: p.callStatus,
      })),
      myCallStatus: activeGamePlayer.callStatus,
    });
  } catch (err) { next(err); }
});

// GET /users/me/profile - get player profile
router.get('/me/profile', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await userService.getProfile(req.user!.userId);
    res.json(profile);
  } catch (err) { next(err); }
});

// PUT /users/me/profile - update player profile
router.put('/me/profile', authenticate, validate(updateProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await userService.updateProfile(req.user!.userId, req.body);
    res.json(profile);
  } catch (err) { next(err); }
});

// GET /users/me/stats - get player stats
router.get('/me/stats', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await userService.getStats(req.user!.userId);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /users/me/history - get game history (paginated)
router.get('/me/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const history = await userService.getHistory(req.user!.userId, page, limit);
    res.json(history);
  } catch (err) { next(err); }
});

// GET /users/me/penalties - get my no-show records
router.get('/me/penalties', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const penalties = await userService.getPenalties(req.user!.userId);
    res.json(penalties);
  } catch (err) { next(err); }
});

export default router;

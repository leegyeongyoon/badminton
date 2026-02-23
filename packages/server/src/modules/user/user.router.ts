import { Router, Request, Response, NextFunction } from 'express';
import { updateProfileSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as userService from './user.service';
import * as turnService from '../turn/turn.service';

const router = Router();

// GET /users/me/turns/current - get my active turns
router.get('/me/turns/current', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const turns = await turnService.getMyTurns(req.user!.userId);
    res.json(turns);
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

// GET /users/me/admin-facilities - get facilities where user is admin
router.get('/me/admin-facilities', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facilities = await userService.getAdminFacilities(req.user!.userId);
    res.json(facilities);
  } catch (err) { next(err); }
});

export default router;

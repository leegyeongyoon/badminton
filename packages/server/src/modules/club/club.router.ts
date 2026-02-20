import { Router, Request, Response, NextFunction } from 'express';
import { createClubSchema, joinClubSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as clubService from './club.service';

const router = Router();

router.post('/', authenticate, validate(createClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.createClub(req.user!.userId, req.body);
    res.status(201).json(club);
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clubs = await clubService.listMyClubs(req.user!.userId);
    res.json(clubs);
  } catch (err) { next(err); }
});

router.post('/join', authenticate, validate(joinClubSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clubService.joinClub(req.user!.userId, req.body.inviteCode);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id/members', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const members = await clubService.getMembers(req.params.id);
    res.json(members);
  } catch (err) { next(err); }
});

export default router;

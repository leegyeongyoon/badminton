import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import {
  createGameBoard,
  getGameBoard,
  addEntry,
  updateEntry,
  deleteEntry,
  pushEntry,
  pushAllEntries,
} from './gameBoard.service';

const router = Router();

// POST /club-sessions/:id/game-board
router.post(
  '/:id/game-board',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const board = await createGameBoard(req.params.id as string, req.user!.userId);
      res.status(201).json(board);
    } catch (err) {
      next(err);
    }
  },
);

// GET /club-sessions/:id/game-board
router.get(
  '/:id/game-board',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const board = await getGameBoard(req.params.id as string);
      res.json(board);
    } catch (err) {
      next(err);
    }
  },
);

// POST /game-boards/:id/entries — courtId is optional
router.post(
  '/:id/entries',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { playerIds, courtId } = req.body;
      const entry = await addEntry(req.params.id as string, playerIds, req.user!.userId, courtId);
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /game-boards/:id/entries/:entryId
router.patch(
  '/:id/entries/:entryId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { playerIds } = req.body;
      const entry = await updateEntry(req.params.id as string, req.params.entryId as string, playerIds);
      res.json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /game-boards/:id/entries/:entryId
router.delete(
  '/:id/entries/:entryId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteEntry(req.params.id as string, req.params.entryId as string);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// POST /game-boards/:id/entries/:entryId/push — courtId required in body
router.post(
  '/:id/entries/:entryId/push',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courtId } = req.body;
      const entry = await pushEntry(
        req.params.id as string,
        req.params.entryId as string,
        courtId,
        req.user!.userId,
      );
      res.json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// POST /game-boards/:id/push-all
router.post(
  '/:id/push-all',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await pushAllEntries(req.params.id as string, req.user!.userId);
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import {
  suggestFoursomeSchema,
  createQueueGameSchema,
  reorderQueueSchema,
  assignEntrySchema,
} from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createGameBoard,
  getGameBoard,
  addEntry,
  updateEntry,
  deleteEntry,
  pushEntry,
  pushAllEntries,
  suggestNextFoursome,
  createQueueGame,
  reorderQueue,
  assignEntry,
} from './gameBoard.service';

const router = Router();

// POST /club-sessions/:id/suggest — auto-suggest next foursome(s) for a club session.
// :id is the clubSessionId (use the /club-sessions mount).
router.post(
  '/:id/suggest',
  authenticate,
  validate(suggestFoursomeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courtId, count, mode, exclude } = req.body;
      const result = await suggestNextFoursome(
        req.params.id as string,
        { courtId, count, mode, exclude },
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

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
      const { playerIds, courtId, note } = req.body;
      const entry = await addEntry(req.params.id as string, playerIds, req.user!.userId, courtId, note);
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

// POST /game-boards/:boardId/queue — create a court-less QUEUED game (다음 게임 큐에 추가)
router.post(
  '/:id/queue',
  authenticate,
  validate(createQueueGameSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { playerIds, note } = req.body;
      const entry = await createQueueGame(
        req.params.id as string,
        playerIds,
        req.user!.userId,
        note,
      );
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /game-boards/:boardId/queue/reorder — set the full new queue order
router.patch(
  '/:id/queue/reorder',
  authenticate,
  validate(reorderQueueSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entryIds } = req.body;
      const board = await reorderQueue(req.params.id as string, entryIds, req.user!.userId);
      res.json(board);
    } catch (err) {
      next(err);
    }
  },
);

// POST /game-boards/:boardId/entries/:entryId/assign — assign a queued game to an EMPTY court
router.post(
  '/:id/entries/:entryId/assign',
  authenticate,
  validate(assignEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courtId } = req.body;
      const entry = await assignEntry(
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

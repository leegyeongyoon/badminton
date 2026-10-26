import { Router, Request, Response, NextFunction } from 'express';
import {
  suggestFoursomeSchema,
  createQueueGameSchema,
  createSessionRequestSchema,
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
  getSessionPace,
  createQueueGame,
  reorderQueue,
  assignEntry,
  unassignEntryByCourt,
  updateTagLayout,
} from './gameBoard.service';

import { listRequests, createRequest, deleteRequest } from './sessionRequest.service';

const router = Router();

// POST /club-sessions/:id/suggest — auto-suggest next foursome(s) for a club session.
// :id is the clubSessionId (use the /club-sessions mount).
router.post(
  '/:id/suggest',
  authenticate,
  validate(suggestFoursomeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courtId, count, mode, exclude, tuning, prefs, target } = req.body;
      const result = await suggestNextFoursome(
        req.params.id as string,
        { courtId, count, mode, exclude, tuning, prefs, target },
        req.user!.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── 운영진 편성 요청(파트너로 같이 N게임 / 같이 안 짜기) — 자동 편성이 지킨다. 대표/운영진만. ──
// GET    /club-sessions/:id/requests
// POST   /club-sessions/:id/requests      { kind, aId, bId, games?, note? }
// DELETE /club-sessions/:id/requests/:rid
router.get('/:id/requests', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listRequests(req.params.id as string, req.user!.userId));
  } catch (err) {
    next(err);
  }
});
router.post(
  '/:id/requests',
  authenticate,
  validate(createSessionRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await createRequest(req.params.id as string, req.user!.userId, req.body));
    } catch (err) {
      next(err);
    }
  },
);
router.delete('/:id/requests/:rid', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await deleteRequest(req.params.id as string, req.params.rid as string, req.user!.userId));
  } catch (err) {
    next(err);
  }
});

// GET /club-sessions/:id/pace — 이 클럽의 실데이터 판당 시간 + 정모 1인 주기.
// 운영판 '코트 언제 비나' 예측 기본값 + 자동 편성 공평 주기 표시용. 읽기 전용.
router.get(
  '/:id/pace',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getSessionPace(req.params.id as string));
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
      const { playerIds, note, teamSplit } = req.body;
      // 자동 채우기/땜빵이 이유·팀 구성을 함께 갱신할 수 있게(선택). 형식이 틀리면 무시.
      const extra: { note?: string | null; teamSplit?: boolean } = {};
      if (note === null || (typeof note === 'string' && note.length <= 100)) extra.note = note;
      if (typeof teamSplit === 'boolean') extra.teamSplit = teamSplit;
      const entry = await updateEntry(req.params.id as string, req.params.entryId as string, playerIds, extra);
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
      const { playerIds, note, teamSplit } = req.body;
      const entry = await createQueueGame(
        req.params.id as string,
        playerIds,
        req.user!.userId,
        note,
        teamSplit,
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

// PATCH /game-boards/:boardId/layout — 모드2 자석판 이름표 1개 위치 갱신(운영진 공유)
// Body { userId, x, y } (분수 0~1). LEADER/STAFF 만(서비스에서 검증). 소켓 전파.
router.patch(
  '/:id/layout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, x, y } = req.body;
      const result = await updateTagLayout(
        req.params.id as string,
        userId,
        Number(x),
        Number(y),
        req.user!.userId,
      );
      res.json(result);
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

// POST /game-boards/:id/courts/:courtId/unassign — 코트에 잘못 배정한 게임을 다시 대기 큐로 되돌림
router.post(
  '/:id/courts/:courtId/unassign',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await unassignEntryByCourt(
        req.params.id as string,
        req.params.courtId as string,
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

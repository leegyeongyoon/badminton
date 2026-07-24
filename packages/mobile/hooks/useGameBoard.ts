import { useState, useEffect, useCallback } from 'react';
import { useSocketEvent } from './useSocket';
import { gameBoardApi, type SuggestMode } from '../services/gameBoard';

export interface GameBoardEntry {
  id: string;
  boardId: string;
  /** null = court-less QUEUED game (in the global 다음 게임 queue). */
  courtId: string | null;
  courtName: string;
  position: number;
  /** Global queue order for QUEUED entries (다음 게임 순서). */
  queueOrder: number;
  note?: string | null;
  playerIds: string[];
  playerNames: string[];
  status: string;
  turnId: string | null;
  createdAt: string;
}

export interface GameBoard {
  id: string;
  clubSessionId: string;
  facilityId: string;
  createdById: string;
  createdAt: string;
  entries: GameBoardEntry[];
  /** userIds who are double-booked (currently playing OR in >1 queued game). SOFT flag. */
  busyPlayerIds: string[];
  /**
   * Each = a sorted-joined key "a|b|c|d" of a 4-player group already played /
   * queued this 정모. Used to softly flag a repeat foursome composition.
   */
  playedGroups?: string[];
  /**
   * How many games two players have shared this 정모, keyed by "minId|maxId".
   * Used to softly hint over-pairing while staging.
   */
  pairCounts?: Record<string, number>;
  /**
   * 4인 조합 key "a|b|c|d" -> 이 정모에서 등장한 게임 수(완료/진행 + 대기열).
   * 대기열 "중복 점검"에서 반복 편성(count >= 2)을 정확히 세는 데 쓴다.
   */
  groupCounts?: Record<string, number>;
  /** 모드2 자석판: { [userId]: { x, y } } 분수 좌표(운영진 공유). */
  tagLayout?: Record<string, { x: number; y: number }>;
}

export interface FoursomeSuggestion {
  playerIds: string[];
  playerNames: string[];
}

export function useGameBoard(clubSessionId: string | undefined) {
  const [board, setBoard] = useState<GameBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    if (!clubSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await gameBoardApi.get(clubSessionId);
      setBoard(data);
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [clubSessionId]);

  const createBoard = useCallback(async () => {
    if (!clubSessionId) return;
    setLoading(true);
    try {
      const { data } = await gameBoardApi.create(clubSessionId);
      setBoard(data);
      return data;
    } catch (err: any) {
      setError(err.response?.data?.error || '모임판 생성에 실패했습니다');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [clubSessionId]);

  const addEntry = useCallback(async (playerIds: string[]) => {
    if (!board) return;
    const { data } = await gameBoardApi.addEntry(board.id, playerIds);
    return data;
  }, [board]);

  const updateEntry = useCallback(async (entryId: string, playerIds: string[]) => {
    if (!board) return;
    const { data } = await gameBoardApi.updateEntry(board.id, entryId, playerIds);
    return data;
  }, [board]);

  const deleteEntry = useCallback(async (entryId: string) => {
    if (!board) return;
    await gameBoardApi.deleteEntry(board.id, entryId);
  }, [board]);

  const pushEntry = useCallback(async (entryId: string, courtId: string) => {
    if (!board) return;
    const { data } = await gameBoardApi.pushEntry(board.id, entryId, courtId);
    return data;
  }, [board]);

  const pushAll = useCallback(async () => {
    if (!board) return;
    const { data } = await gameBoardApi.pushAll(board.id);
    return data;
  }, [board]);

  // ─── 전체 "다음 게임" 큐 ───
  // 큐에 새 게임 추가 (2 or 4명). 성공 시 새 보드를 즉시 반영.
  const createQueueGame = useCallback(async (playerIds: string[], note?: string) => {
    if (!board) return;
    const { data } = await gameBoardApi.createQueueGame(board.id, playerIds, note);
    return data;
  }, [board]);

  // 큐 순서 변경 (드래그앤드롭 / ▲▼). 서버가 새 보드를 반환 → 즉시 반영.
  const reorderQueue = useCallback(async (entryIds: string[]) => {
    if (!board) return;
    const { data } = await gameBoardApi.reorderQueue(board.id, entryIds);
    if (data) setBoard(data);
    return data;
  }, [board]);

  // 큐 게임을 빈 코트에 배정 (게임 시작).
  const assignEntry = useCallback(async (entryId: string, courtId: string) => {
    if (!board) return;
    const { data } = await gameBoardApi.assignEntry(board.id, entryId, courtId);
    return data;
  }, [board]);

  // 코트에 잘못 배정한 게임을 다시 대기 큐로 되돌림(배정 취소).
  const unassignByCourt = useCallback(async (courtId: string) => {
    if (!board) return;
    const { data } = await gameBoardApi.unassignByCourt(board.id, courtId);
    return data;
  }, [board]);

  /**
   * 자동 추천: 다음 복식 4인 조합을 서버에서 받아 첫 추천의 playerIds 반환.
   * opts.mode 로 매칭 전략 선택(기본 fair). 서버가 실제 적용한 mode 도 함께 반환.
   * 인원 부족(서버가 빈 배열 반환) 시 playerIds [] 반환. 404/오류 시 throw.
   */
  const suggestNext = useCallback(
    async (opts?: { courtId?: string; mode?: SuggestMode; exclude?: string[] }): Promise<{
      playerIds: string[];
      effectiveMode?: SuggestMode;
      note?: string;
    }> => {
      if (!clubSessionId) return { playerIds: [] };
      setSuggesting(true);
      setSuggestError(null);
      try {
        const body: { courtId?: string; mode?: SuggestMode; exclude?: string[] } = {};
        if (opts?.courtId) body.courtId = opts.courtId;
        if (opts?.mode) body.mode = opts.mode;
        if (opts?.exclude && opts.exclude.length > 0) body.exclude = opts.exclude;
        const { data } = await gameBoardApi.suggest(clubSessionId, body);
        const suggestions: FoursomeSuggestion[] = data?.suggestions ?? [];
        return {
          playerIds: suggestions[0]?.playerIds ?? [],
          effectiveMode: data?.mode as SuggestMode | undefined,
          note: data?.note as string | undefined,
        };
      } catch (err: any) {
        setSuggestError(err.response?.data?.error || '추천에 실패했습니다');
        throw err;
      } finally {
        setSuggesting(false);
      }
    },
    [clubSessionId],
  );

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Socket events for real-time updates
  useSocketEvent('gameBoard:entryAdded', loadBoard);
  useSocketEvent('gameBoard:entryUpdated', loadBoard);
  useSocketEvent('gameBoard:entryRemoved', loadBoard);
  useSocketEvent('gameBoard:entryPushed', loadBoard);
  useSocketEvent('gameBoard:reordered', loadBoard);

  return {
    board,
    loading,
    error,
    suggesting,
    suggestError,
    loadBoard,
    createBoard,
    addEntry,
    updateEntry,
    deleteEntry,
    pushEntry,
    pushAll,
    suggestNext,
    createQueueGame,
    reorderQueue,
    assignEntry,
    unassignByCourt,
  };
}

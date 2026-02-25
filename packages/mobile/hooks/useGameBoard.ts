import { useState, useEffect, useCallback } from 'react';
import { useSocketEvent } from './useSocket';
import { gameBoardApi } from '../services/gameBoard';

export interface GameBoardEntry {
  id: string;
  boardId: string;
  courtId: string;
  courtName: string;
  position: number;
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
}

export function useGameBoard(clubSessionId: string | undefined) {
  const [board, setBoard] = useState<GameBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Socket events for real-time updates
  useSocketEvent('gameBoard:entryAdded', loadBoard);
  useSocketEvent('gameBoard:entryUpdated', loadBoard);
  useSocketEvent('gameBoard:entryRemoved', loadBoard);
  useSocketEvent('gameBoard:entryPushed', loadBoard);

  return {
    board,
    loading,
    error,
    loadBoard,
    createBoard,
    addEntry,
    updateEntry,
    deleteEntry,
    pushEntry,
    pushAll,
  };
}

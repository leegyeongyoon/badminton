import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@badminton/shared';
import { logger } from '../utils/logger';
import { noteConnect, noteDisconnect, noteSocketUser, registerIO } from '../modules/admin/metrics.service';
import { isRallyMember } from '../modules/rallyGame/rallyGame.store';

let io: Server<ClientToServerEvents, ServerToClientEvents>;

export function initSocketIO(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    pingInterval: 25000,
    pingTimeout: 20000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });
  registerIO(io); // 대시보드 '현재 접속'을 io.engine.clientsCount(권위값)로 계산하도록 등록

  io.on('connection', (socket) => {
    noteConnect(); // 동시접속 집계(슈퍼관리자 대시보드)
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('facility:join', (facilityId: string) => {
      socket.join(`facility:${facilityId}`);
      logger.debug(`Socket ${socket.id} joined facility:${facilityId}`);
    });

    socket.on('facility:leave', (facilityId: string) => {
      socket.leave(`facility:${facilityId}`);
    });

    socket.on('court:join', (courtId: string) => {
      socket.join(`court:${courtId}`);
      logger.debug(`Socket ${socket.id} joined court:${courtId}`);
    });

    socket.on('court:leave', (courtId: string) => {
      socket.leave(`court:${courtId}`);
    });

    socket.on('clubSession:join', (clubSessionId: string) => {
      socket.join(`clubSession:${clubSessionId}`);
      logger.debug(`Socket ${socket.id} joined clubSession:${clubSessionId}`);
    });

    socket.on('clubSession:leave', (clubSessionId: string) => {
      socket.leave(`clubSession:${clubSessionId}`);
    });

    socket.on('club:join', (clubId: string) => {
      socket.join(`club:${clubId}`);
      logger.debug(`Socket ${socket.id} joined club:${clubId}`);
    });

    socket.on('club:leave', (clubId: string) => {
      socket.leave(`club:${clubId}`);
    });

    socket.on('user:join', (userId: string) => {
      socket.join(`user:${userId}`);
      noteSocketUser(socket.id, userId); // '누가 접속 중' 집계(대시보드)
      logger.debug(`Socket ${socket.id} joined user:${userId}`);
    });

    socket.on('user:leave', (userId: string) => {
      socket.leave(`user:${userId}`);
    });

    // ── 콕고 랠리 PvP — 서버는 릴레이만. matchId 발급·검증은 REST(rallyGame)에서.
    // 소켓이 무인증이므로 매치 멤버 대조 후에만 룸에 넣고, 이후 릴레이는 룸 소속으로만 판단.
    socket.on('rally:join', (data) => {
      try {
        if (!data?.matchId || !data?.userId || !isRallyMember(data.matchId, data.userId)) return;
        socket.data.rallyMatchId = data.matchId;
        socket.data.rallyUserId = data.userId;
        socket.join(`rally:${data.matchId}`);
        // 재접속이면 이탈 유예 취소 — 순간 끊김으로 매치가 죽지 않는다
        const { cancelLeave } = require('../modules/rallyGame/rallyGame.service');
        cancelLeave(data.matchId, data.userId);
        logger.debug(`Socket ${socket.id} joined rally:${data.matchId}`);
      } catch (err) {
        logger.warn(`rally:join failed: ${(err as Error).message}`);
      }
    });

    socket.on('rally:leave', (data) => {
      try {
        if (!data?.matchId || socket.data.rallyMatchId !== data.matchId) return;
        socket.leave(`rally:${data.matchId}`);
        // 상대에게 이탈 통지 + 매치 정리 (지연 import — 순환 방지)
        const { leaveMatch } = require('../modules/rallyGame/rallyGame.service');
        leaveMatch(data.matchId, socket.data.rallyUserId as string);
        socket.data.rallyMatchId = undefined;
      } catch (err) {
        logger.warn(`rally:leave failed: ${(err as Error).message}`);
      }
    });

    const relayRally = (event: 'rally:input' | 'rally:snapshot' | 'rally:event') => {
      socket.on(event, (data: { matchId: string; payload: unknown }) => {
        try {
          if (!data?.matchId || socket.data.rallyMatchId !== data.matchId) return;
          socket.to(`rally:${data.matchId}`).emit(event, { payload: data.payload });
        } catch (err) {
          logger.warn(`${event} relay failed: ${(err as Error).message}`);
        }
      });
    };
    relayRally('rally:input');
    relayRally('rally:snapshot');
    relayRally('rally:event');

    socket.on('disconnect', () => {
      noteDisconnect(socket.id); // 동시접속 집계 + 온라인 사용자 정리
      try {
        if (socket.data.rallyMatchId) {
          // 즉시 종료 대신 20초 유예 — 재조인하면 매치 유지 (백그라운드 전환·리로드 보호)
          const { scheduleLeave } = require('../modules/rallyGame/rallyGame.service');
          scheduleLeave(socket.data.rallyMatchId as string, socket.data.rallyUserId as string);
        }
      } catch (err) {
        logger.warn(`rally disconnect cleanup failed: ${(err as Error).message}`);
      }
      logger.debug(`Socket disconnected: ${socket.id}`);
    });

    socket.on('error', (err) => {
      logger.warn(`Socket ${socket.id} error: ${err.message}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    // Return a no-op proxy during startup/testing
    return {
      to: () => ({
        emit: () => {},
      }),
    } as any;
  }
  return io;
}

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@badminton/shared';
import { logger } from '../utils/logger';

let io: Server<ClientToServerEvents, ServerToClientEvents>;

export function initSocketIO(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
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

    socket.on('user:join', (userId: string) => {
      socket.join(`user:${userId}`);
      logger.debug(`Socket ${socket.id} joined user:${userId}`);
    });

    socket.on('user:leave', (userId: string) => {
      socket.leave(`user:${userId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
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

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../constants/api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: false,
    });
  }
  return socket;
}

export function useSocket() {
  const socketRef = useRef(getSocket());

  useEffect(() => {
    const s = socketRef.current;
    if (!s.connected) {
      s.connect();
    }
    return () => {
      // Don't disconnect on unmount - keep alive
    };
  }, []);

  return socketRef.current;
}

export function useSocketEvent<T = any>(
  event: string,
  handler: (data: T) => void,
) {
  const socket = useSocket();

  useEffect(() => {
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler, socket]);
}

export function useFacilityRoom(facilityId: string | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!facilityId) return;
    socket.emit('facility:join', facilityId);
    return () => {
      socket.emit('facility:leave', facilityId);
    };
  }, [facilityId, socket]);
}

export function useCourtRoom(courtId: string | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!courtId) return;
    socket.emit('court:join', courtId);
    return () => {
      socket.emit('court:leave', courtId);
    };
  }, [courtId, socket]);
}

export function useUserRoom(userId: string | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!userId) return;
    socket.emit('user:join', userId);
    return () => {
      socket.emit('user:leave', userId);
    };
  }, [userId, socket]);
}

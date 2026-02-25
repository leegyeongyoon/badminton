import { useEffect, useRef, useState } from 'react';
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

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
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

    const handleReconnect = () => {
      socket.emit('facility:join', facilityId);
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('connect', handleReconnect);
      socket.emit('facility:leave', facilityId);
    };
  }, [facilityId, socket]);
}

export function useCourtRoom(courtId: string | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!courtId) return;
    socket.emit('court:join', courtId);

    const handleReconnect = () => {
      socket.emit('court:join', courtId);
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('connect', handleReconnect);
      socket.emit('court:leave', courtId);
    };
  }, [courtId, socket]);
}

export function useUserRoom(userId: string | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!userId) return;
    socket.emit('user:join', userId);

    const handleReconnect = () => {
      socket.emit('user:join', userId);
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('connect', handleReconnect);
      socket.emit('user:leave', userId);
    };
  }, [userId, socket]);
}

/**
 * Track socket connection state (connected / reconnecting).
 */
export function useSocketConnectionState() {
  const socket = useSocket();
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setReconnecting(false);
    };
    const handleDisconnect = () => {
      setConnected(false);
    };
    const handleReconnectAttempt = () => {
      setReconnecting(true);
    };
    const handleReconnectFailed = () => {
      setReconnecting(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.io.on('reconnect_failed', handleReconnectFailed);

    // Sync initial state
    setConnected(socket.connected);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.io.off('reconnect_failed', handleReconnectFailed);
    };
  }, [socket]);

  return { connected, reconnecting };
}

import { useState, useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { getSocket } from './useSocket';

/**
 * Network + socket connectivity for the "재연결 중 / 인터넷 연결 없음" status bar.
 *
 * The socket state is tracked by POLLING `socket.connected` (every 1.5s) rather
 * than only by event listeners. Listeners are race-prone here: the singleton
 * socket (autoConnect:false) is connected by the root layout, and its `connect`
 * event can fire before this hook attaches its listener — which left
 * `isSocketConnected` stuck on a stale `false` and the "재연결 중" banner showing
 * forever even though real-time sync actually worked. Polling reflects reality
 * within 1.5s regardless of timing or socket re-creation (logout/login).
 *
 * The banner is also suppressed during the INITIAL connecting phase: we only flip
 * to "disconnected" once the socket has actually been connected at least once and
 * then dropped — so a fresh load never flashes a false "재연결 중".
 */
export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(true);
  const everConnectedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      const socket = getSocket();
      if (!socket.connected) socket.connect(); // keep trying
      if (!mounted) return;
      if (socket.connected) {
        everConnectedRef.current = true;
        setIsSocketConnected(true);
      } else if (everConnectedRef.current) {
        // Only treat as "disconnected" after a REAL drop following a prior
        // connection — never during the first-connect handshake.
        setIsSocketConnected(false);
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return {
    isConnected,
    isSocketConnected,
    isFullyConnected: isConnected && isSocketConnected,
  };
}

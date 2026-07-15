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
 * GRACE PERIODS — the banner is intentionally SLOW to appear so it never flashes
 * on the brief, normal blips that browsers/phones (and every server redeploy!)
 * cause. It only surfaces for a SUSTAINED problem:
 *   - socket: must fail ~3 consecutive polls (~4.5s) before "재연결 중"
 *   - network: must stay offline ~3s before "인터넷 연결 없음"
 * Recovery clears instantly. The banner is also suppressed during the INITIAL
 * connecting phase (everConnectedRef) so a fresh load never flashes a false
 * "재연결 중".
 */
const SOCKET_FAIL_GRACE = 3; // consecutive 1.5s polls (~4.5s) before showing
const NET_OFFLINE_GRACE_MS = 3000; // sustained offline before showing

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(true);
  const everConnectedRef = useRef(false);
  const failCountRef = useRef(0);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected ?? true;
      if (online) {
        // Back online → clear any pending "offline" timer and recover instantly.
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        setIsConnected(true);
      } else if (!offlineTimerRef.current) {
        // Only flip to offline after it STAYS offline past the grace window, so a
        // wifi handoff / momentary drop never flashes the red bar.
        offlineTimerRef.current = setTimeout(() => {
          setIsConnected(false);
          offlineTimerRef.current = null;
        }, NET_OFFLINE_GRACE_MS);
      }
    });
    return () => {
      unsubscribe();
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      const socket = getSocket();
      if (!socket.connected) socket.connect(); // keep trying
      if (!mounted) return;
      if (socket.connected) {
        everConnectedRef.current = true;
        failCountRef.current = 0;
        setIsSocketConnected(true);
      } else if (everConnectedRef.current) {
        // Only treat as "disconnected" after a REAL drop (post-first-connect)
        // that persists past the grace window — brief reconnects (server
        // redeploy, tab backgrounding, network hiccup) recover silently.
        failCountRef.current += 1;
        if (failCountRef.current >= SOCKET_FAIL_GRACE) setIsSocketConnected(false);
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

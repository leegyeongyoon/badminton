/**
 * 콕고 랠리 PvP — 소켓 배관 (호스트 권위 + 입력/스냅샷 하이브리드).
 *
 * 서버는 rally:<matchId> 룸 릴레이만 한다(게임 로직 없음). 방향:
 *   게스트 → 호스트: rally:input  {t:'joy'|'swing'|'serve'|'again', ...}  (~15Hz)
 *   호스트 → 게스트: rally:snapshot (게스트 프레임 미러, ~12Hz — rally.tsx 루프가 쏜다)
 * 좌표 규약: 게스트는 자기 뷰 프레임으로 보내고, 호스트가 월드로 부호 반전한다.
 */
import { getSocket } from '../../hooks/useSocket';
import type { AimDepth, AimLane, NetSnapshot, SwingIntent } from './sim';

export type RallyInputMsg =
  | { t: 'joy'; dx: number; dy: number }
  | { t: 'swing'; intent: SwingIntent; aim: AimLane; depth?: AimDepth }
  | { t: 'serve'; kind: 'short' | 'long'; gauge: number }
  | { t: 'again' };

const JOY_SEND_MS = 66; // ~15Hz

export interface RallyNet {
  /** 게스트: 조이스틱 벡터(뷰 프레임) — 스로틀해서 송신. 매 프레임 불러도 된다. */
  sendJoy(dx: number, dy: number): void;
  sendSwing(intent: SwingIntent, aim: AimLane, depth: AimDepth): void;
  sendServe(kind: 'short' | 'long', gauge: number): void;
  sendAgain(): void;
  /** 호스트: 미러 스냅샷 송신 — rally.tsx 루프가 12Hz로 부른다. */
  sendSnapshot(snap: NetSnapshot): void;
  dispose(): void;
}

export function connectRally(
  matchId: string,
  userId: string,
  handlers: {
    onInput?: (msg: RallyInputMsg) => void; // 호스트가 받는 게스트 입력
    onSnapshot?: (snap: NetSnapshot) => void; // 게스트가 받는 미러 상태
    onOpponentLeft?: () => void;
  },
): RallyNet {
  const socket = getSocket();
  if (!socket.connected) socket.connect();

  const join = () => socket.emit('rally:join', { matchId, userId });
  join();
  socket.on('connect', join); // 재접속 시 룸 재조인

  const onInput = (data: { payload: RallyInputMsg }) => handlers.onInput?.(data?.payload);
  const onSnapshot = (data: { payload: NetSnapshot }) => {
    if (data?.payload) handlers.onSnapshot?.(data.payload);
  };
  const onLeft = () => handlers.onOpponentLeft?.();
  socket.on('rally:input', onInput);
  socket.on('rally:snapshot', onSnapshot);
  socket.on('rally:opponentLeft', onLeft);

  let lastJoyAt = 0;
  let lastJoy = { dx: 0, dy: 0 };

  return {
    sendJoy(dx, dy) {
      const now = Date.now();
      const changed = Math.abs(dx - lastJoy.dx) > 0.03 || Math.abs(dy - lastJoy.dy) > 0.03;
      // 변화 없으면 저빈도 하트비트만 — 멈춘 스틱을 호스트가 놓치지 않게
      if (now - lastJoyAt < JOY_SEND_MS || (!changed && now - lastJoyAt < 250)) return;
      lastJoyAt = now;
      lastJoy = { dx, dy };
      socket.emit('rally:input', { matchId, payload: { t: 'joy', dx, dy } });
    },
    sendSwing(intent, aim, depth) {
      socket.emit('rally:input', { matchId, payload: { t: 'swing', intent, aim, depth } });
    },
    sendServe(kind, gauge) {
      socket.emit('rally:input', { matchId, payload: { t: 'serve', kind, gauge } });
    },
    sendAgain() {
      socket.emit('rally:input', { matchId, payload: { t: 'again' } });
    },
    sendSnapshot(snap) {
      socket.emit('rally:snapshot', { matchId, payload: snap });
    },
    dispose() {
      socket.emit('rally:leave', { matchId });
      socket.off('connect', join);
      socket.off('rally:input', onInput);
      socket.off('rally:snapshot', onSnapshot);
      socket.off('rally:opponentLeft', onLeft);
    },
  };
}

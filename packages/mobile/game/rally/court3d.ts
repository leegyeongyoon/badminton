/**
 * 콕고 랠리 — 3D 코트 좌표계와 원근 투영.
 *
 * 월드 좌표(미터): x=좌우(코트 중앙 0, 단식 라인 ±2.59, 복식 ±3.05),
 * y=깊이(네트 0, 내 베이스라인 -6.7, 상대 +6.7), z=높이(바닥 0, 네트 1.55).
 * 카메라는 내 코트 뒤 위에서 상대 코트를 내려다본다.
 */

export const COURT = {
  HALF_LEN: 6.7,
  HALF_W: 3.05, // 복식 사이드라인
  SINGLES_W: 2.59, // 단식 사이드라인 — 게임 판정 기준
  SHORT_SERVICE: 1.98, // 네트에서 숏서비스라인까지
  NET_H: 1.55,
} as const;

// 카메라/투영 파라미터 — 룩을 결정하는 튜닝 값
const CAM_D = 16; // 카메라가 네트에서 뒤로 떨어진 거리(내 쪽)
const CAM_H = 9; // 카메라 높이
const F_RATIO = 1.38; // 초점거리 = 컨테이너 폭 × 비율

export interface Projector {
  x: (wx: number, wy: number) => number;
  y: (wy: number, wz: number) => number;
  scale: (wy: number) => number; // 해당 깊이에서의 크기 배율(근경=1 근처)
  w: number;
  h: number;
}

export function makeProjector(w: number, h: number): Projector {
  const F = w * F_RATIO;
  const cx = w / 2;
  // 내 베이스라인이 화면 하단 ~90%에 오도록 수평선(horizon)을 잡는다
  const nearDy = -COURT.HALF_LEN + CAM_D; // 9.3
  const horizon = h * 0.9 - (CAM_H / nearDy) * F;
  const proj = {
    x: (wx: number, wy: number) => cx + (wx / (wy + CAM_D)) * F,
    y: (wy: number, wz: number) => horizon + ((CAM_H - wz) / (wy + CAM_D)) * F,
    scale: (wy: number) => nearDy / (wy + CAM_D),
    w,
    h,
  };
  return proj;
}

// 코트 라인 정의(월드 좌표) — 렌더러가 투영해 그린다.
// 가로선: y 고정, x는 코트 폭 전체 (화면에서 수평선으로 투영됨)
export const H_LINES: { y: number; label: string }[] = [
  { y: -COURT.HALF_LEN, label: 'baseline-near' },
  { y: -COURT.SHORT_SERVICE, label: 'service-near' },
  { y: COURT.SHORT_SERVICE, label: 'service-far' },
  { y: COURT.HALF_LEN, label: 'baseline-far' },
];
// 세로선: x 고정, y는 전체 길이 (화면에서 기울어진 선으로 투영됨)
export const V_LINES: { x: number; label: string }[] = [
  { x: -COURT.HALF_W, label: 'side-l' },
  { x: -COURT.SINGLES_W, label: 'singles-l' },
  { x: 0, label: 'center' },
  { x: COURT.SINGLES_W, label: 'singles-r' },
  { x: COURT.HALF_W, label: 'side-r' },
];

// 기울어진 선분의 화면 배치(중점+회전) 계산
export function segmentStyle(
  p: Projector,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
) {
  const ax = p.x(x1, y1);
  const ay = p.y(y1, 0);
  const bx = p.x(x2, y2);
  const by = p.y(y2, 0);
  const len = Math.hypot(bx - ax, by - ay);
  const angle = Math.atan2(by - ay, bx - ax);
  return {
    left: (ax + bx) / 2 - len / 2,
    top: (ay + by) / 2 - thickness / 2,
    width: len,
    height: thickness,
    transform: [{ rotate: `${angle}rad` }],
  };
}

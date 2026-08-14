import { useEffect, useState } from 'react';
import { API_URL } from '../constants/api';

// ── 서버 점검 감지 ─────────────────────────────────────────────
// health가 실패하는 동안 true. 서버가 복구되면 다음 폴링에서 자동 해제되므로
// 안내 제거 배포가 필요 없다. 로그인 카드(login.tsx)와 전역 배너가 공유한다.
const HEALTH_URL = `${API_URL}/health`;
const HEALTH_TIMEOUT_MS = 5_000;

export function useServerDown(intervalMs = 30_000): boolean {
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
        const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
        clearTimeout(timer);
        if (alive) setDown(!res.ok);
      } catch {
        if (alive) setDown(true);
      }
    };
    check();
    const id = setInterval(check, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  return down;
}

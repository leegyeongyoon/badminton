import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameBoard } from './useGameBoard';
import { useFacilityRoom, useSocketEvent } from './useSocket';
import api from '../services/api';

// 정모 현황(코트별 현재 게임 + 다음 게임 대기열 + 대기 명단)의 '데이터 계층'을 재사용 가능한
// 훅으로 추출한 것. 참가자 현황판(board.tsx)이 컴포넌트 본문에 인라인으로 갖고 있던 로딩·실시간·
// 파생 로직과 동일하며, 모니터링 모드(monitor.tsx)가 그대로 재사용한다. 개인화("내 차례" 등)는
// 화면(뷰) 쪽에서 처리하고 여기선 다루지 않는다.
//
// 실시간: facility 룸의 소켓 이벤트 15종을 600ms 창으로 합쳐(coalesce) 재조회 → 서버 폭주 방지.
// 7초 폴링 폴백. 30초마다 nowTs 를 갱신해 'N분 진행 중' 경과시간을 살아있게 한다.

const POLL_INTERVAL_MS = 7000;

export interface LiveBoardPlayer {
  userId: string;
  userName: string;
  skillLevel?: string;
  gender?: 'M' | 'F' | null;
  status: string;
  gamesPlayedToday?: number;
  isGuest?: boolean;
}

export interface LiveBoardCourt {
  id: string;
  name: string;
  status: string;
  currentTurn?: { playerIds: string[]; playerNames: string[]; startedAt?: string | null } | null;
}

export interface LiveCourtGame {
  playerIds: string[];
  playerNames: string[];
  startedAt?: string | null;
}

export function useSessionLiveBoard(clubSessionId?: string) {
  const { board, loadBoard } = useGameBoard(clubSessionId);

  const [courts, setCourts] = useState<LiveBoardCourt[]>([]);
  const [players, setPlayers] = useState<LiveBoardPlayer[]>([]);
  const [dedicatedCourtIds, setDedicatedCourtIds] = useState<Set<string>>(new Set());
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const [clubName, setClubName] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  // 코트 경과시간용 현재시각 — 30초마다 갱신해 'N분 진행 중'을 살아있게.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // ─── 세션 메타(facilityId / clubName / 전용 코트) ───
  useEffect(() => {
    if (!clubSessionId) return;
    let alive = true;
    api.get(`/club-sessions/${clubSessionId}`).then(({ data }) => {
      if (!alive) return;
      setFacilityId(data?.facilityId);
      setClubName(data?.clubName || '');
      if (data?.courtIds) setDedicatedCourtIds(new Set(data.courtIds));
    }).catch(() => {});
    return () => { alive = false; };
  }, [clubSessionId]);

  // ─── 코트 + 플레이어(이 정모 스코프) ───
  const loadPool = useCallback(() => {
    if (!clubSessionId) return;
    Promise.all([
      api.get(`/club-sessions/${clubSessionId}/courts`).then(({ data }) =>
        setCourts((data || []).filter((c: any) => c.status !== 'MAINTENANCE')),
      ),
      api.get(`/club-sessions/${clubSessionId}/players`).then(({ data }) =>
        setPlayers(data || []),
      ),
    ]).catch(() => {}).finally(() => setLoaded(true));
  }, [clubSessionId]);

  useEffect(() => { loadPool(); }, [loadPool]);

  // ─── 실시간(소켓 15종, 600ms 디바운스) + 7초 폴링 ───
  useFacilityRoom(facilityId);
  const refreshTimer = useRef<any>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; loadPool(); loadBoard(); }, 600);
  }, [loadPool, loadBoard]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  useSocketEvent('players:updated', refresh);
  useSocketEvent('checkin:arrived', refresh);
  useSocketEvent('checkin:left', refresh);
  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('clubSession:courtsUpdated', refresh);
  useSocketEvent('gameBoard:entryAdded', refresh);
  useSocketEvent('gameBoard:entryPushed', refresh);
  useSocketEvent('gameBoard:entryUpdated', refresh);
  useSocketEvent('gameBoard:entryRemoved', refresh);
  useSocketEvent('gameBoard:reordered', refresh);
  useSocketEvent('turn:created', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);
  useSocketEvent('court:statusChanged', refresh);

  useEffect(() => {
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // ─── 파생 ───
  const uniquePlayers = useMemo(() => {
    const map = new Map<string, LiveBoardPlayer>();
    for (const p of players) if (!map.has(p.userId)) map.set(p.userId, p);
    return Array.from(map.values());
  }, [players]);

  const playerMap = useMemo(() => {
    const map = new Map<string, LiveBoardPlayer>();
    for (const p of uniquePlayers) map.set(p.userId, p);
    return map;
  }, [uniquePlayers]);
  const getPlayer = useCallback((id: string) => playerMap.get(id), [playerMap]);

  // 코트별 현재 게임 — board.entries 의 PLAYING/MATERIALIZED 를 먼저, courts 의 currentTurn 이
  // authoritative 로 덮어씀(코트에 직접 만든 게임까지 포함).
  const playingByCourtId = useMemo(() => {
    const map = new Map<string, LiveCourtGame>();
    for (const e of board?.entries || []) {
      if ((e.status === 'PLAYING' || e.status === 'MATERIALIZED') && e.courtId) {
        map.set(e.courtId, { playerIds: e.playerIds, playerNames: e.playerNames, startedAt: (e as any).startedAt ?? null });
      }
    }
    for (const c of courts) {
      const ct = c.currentTurn;
      if (ct && ct.playerIds?.length) {
        map.set(c.id, { playerIds: ct.playerIds, playerNames: ct.playerNames || [], startedAt: ct.startedAt ?? null });
      }
    }
    return map;
  }, [board, courts]);

  // 다음 게임 대기열 — 운영판과 동일하게 queueOrder 오름차순(대기 1,2,3…).
  const queuedEntries = useMemo(
    () => (board?.entries || [])
      .filter((e) => e.status === 'QUEUED')
      .sort((a, b) => ((a as any).queueOrder ?? a.position) - ((b as any).queueOrder ?? b.position)),
    [board],
  );

  const onCourtPlayerIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of playingByCourtId.values()) for (const id of e.playerIds) s.add(id);
    return s;
  }, [playingByCourtId]);

  // 대기 명단 = 체크인했지만 코트에 없는(AVAILABLE/RESTING) 사람, 적게 친 순(대략적 공정성).
  const waiting = useMemo(
    () => uniquePlayers
      .filter((p) => !onCourtPlayerIds.has(p.userId) && (p.status === 'AVAILABLE' || p.status === 'RESTING'))
      .sort((a, b) => (a.gamesPlayedToday ?? 0) - (b.gamesPlayedToday ?? 0)),
    [uniquePlayers, onCourtPlayerIds],
  );

  // 이 정모 전용 코트만(courtIds). 없으면 전체.
  const displayCourts = useMemo(() => {
    const dedicated = courts.filter((c) => dedicatedCourtIds.has(c.id));
    return dedicated.length > 0 ? dedicated : courts;
  }, [courts, dedicatedCourtIds]);

  return {
    clubName,
    facilityId,
    courts,
    displayCourts,
    players: uniquePlayers,
    getPlayer,
    playingByCourtId,
    queuedEntries,
    waiting,
    nowTs,
    loaded,
    refresh,
  };
}

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  SafeAreaView, ActivityIndicator, Animated as RNAnimated, LayoutAnimation,
  Platform, UIManager, Modal, KeyboardAvoidingView, PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameBoard, GameBoardEntry } from '../../../hooks/useGameBoard';
import type { SuggestMode } from '../../../services/gameBoard';
import { useTheme } from '../../../hooks/useTheme';
import { useResponsiveLayout, courtColumnsFor } from '../../../hooks/useResponsiveLayout';
import type { LayoutChangeEvent } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useFacilityRoom, useClubRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta, SKILL_LEVELS } from '../../../constants/skill';
import { getGenderMeta, getGameType } from '../../../constants/gender';
import { PlayerCard } from '../../../components/game-board/PlayerCard';
import api from '../../../services/api';
import { clubApi } from '../../../services/club';
import { clubSessionApi, GuestFeeSettlement, PlayerMatchups, SessionCourt } from '../../../services/clubSession';
import { courtApi } from '../../../services/court';
import { showAlert, showConfirm } from '../../../utils/alert';
import { showSuccess, showError } from '../../../utils/feedback';
import { copyToClipboard } from '../../../utils/clipboard';
import { typography, spacing, radius, palette } from '../../../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Player {
  userId: string;
  userName: string;
  skillLevel?: string;
  gender?: 'M' | 'F' | null;
  status: string;
  gamesPlayedToday?: number;
  isGuest?: boolean;
}

interface Court {
  id: string;
  name: string;
  status: string; // EMPTY | IN_USE | MAINTENANCE
  // The currently-running game on this court (from the server), if any. Present
  // even for games created directly (no GameBoardEntry) so the board never
  // mistakes an occupied court for empty.
  currentTurn?: {
    id: string;
    status: string;
    playerIds: string[];
    playerNames: string[];
  } | null;
}

type RoleState = 'loading' | 'allowed' | 'denied';

// 자동 추천 매칭 모드 — 운영자가 전략을 고르는 칩. label(짧은 이름) + hint(한 줄 설명)
// + note(추천 후 트레이에 보여줄 안내문). 서버 mode enum 과 1:1.
const SUGGEST_MODES: {
  mode: SuggestMode;
  emoji: string;
  label: string;
  hint: string;
  note: string;
}[] = [
  { mode: 'fair', emoji: '⚖️', label: '공정', hint: '적게 친 사람 우선 · 새 파트너', note: '공정하게 추천했어요' },
  { mode: 'similar', emoji: '🎯', label: '비슷한 급수', hint: '급수 차이가 가장 작게', note: '비슷한 급수로 추천했어요' },
  { mode: 'balanced', emoji: '🤝', label: '균형 접전', hint: '2:2 실력이 팽팽하게', note: '균형 접전으로 추천했어요' },
  { mode: 'competitive', emoji: '🔥', label: '빡센 게임', hint: '가장 고수 4인', note: '빡센 게임으로 추천했어요' },
  { mode: 'fresh', emoji: '✨', label: '새 조합', hint: '안 친 사람들끼리', note: '새 조합으로 추천했어요' },
  { mode: 'mixed', emoji: '👫', label: '혼복', hint: '남2 여2', note: '혼복으로 추천했어요' },
];

// ─── Drag-to-compose registry ───────────────────────────────
// A tiny absolute-coordinate drop-target registry so a player tile dragged
// out of the 미편성 pool (PanResponder, works on react-native-web) can be
// dropped onto a game slot. Targets register their on-screen rect (measured
// via measureInWindow); on drag release we hit-test the finger's pageX/pageY.
// 'tray'/'queue' = a player-tile drop slot (compose). 'queue-card' = a whole
// queued game card registered as a reorder drop target (drag the card itself to
// reorder the 다음 게임 대기열).
type DropKind = 'tray' | 'queue' | 'queue-card';
interface DropTarget {
  id: string;            // unique key
  kind: DropKind;
  entryId?: string;      // queued entry id (for kind === 'queue'/'queue-card')
  slotIndex: number;     // 0..3 for tray/queue; the queue INDEX for 'queue-card'
  rect: { x: number; y: number; w: number; h: number };
}

// Safe LayoutAnimation (web treats it as a no-op but guard anyway)
function animateNext() {
  if (Platform.OS === 'web') return;
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export default function OperateScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const { user } = useAuthStore();
  const layout = useResponsiveLayout();
  // TWO-PANE side-by-side only on genuinely WIDE screens. Tablets in portrait
  // (768/834), narrow laptops and phones all use a single-column STACKED layout
  // so each cell stays wide enough that Korean names never clip.
  const twoPane = layout.twoPane;

  // Actual laid-out width of the courts area (measured, NOT the window) → drives
  // the court-grid column count so each court cell is ≥ ~150px wide.
  const [courtAreaWidth, setCourtAreaWidth] = useState(0);
  const onCourtAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setCourtAreaWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);
  const courtColumns = courtColumnsFor(courtAreaWidth || layout.width);
  // Court-grid gap (must match styles.courtGrid gap). Used to compute an exact
  // pixel width per court from the measured container so cells never clip.
  const COURT_GAP = spacing.sm;
  // Pixel width of a single court card given the measured area + column count.
  // 1-col → full width (undefined). Memoized so the value is stable per render.
  const courtCardWidth = useMemo(() => {
    if (!courtAreaWidth || courtColumns <= 1) return undefined;
    return Math.floor((courtAreaWidth - COURT_GAP * (courtColumns - 1)) / courtColumns);
  }, [courtAreaWidth, courtColumns, COURT_GAP]);

  const {
    board, loading, error,
    createBoard, loadBoard,
    deleteEntry, suggestNext, suggesting,
    createQueueGame, reorderQueue, assignEntry, updateEntry,
  } = useGameBoard(clubSessionId);

  const [courts, setCourts] = useState<Court[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const [clubName, setClubName] = useState<string>('');
  const [clubId, setClubId] = useState<string | undefined>(undefined);
  // 운영판에 머무는 동안 들어온 채팅/건의(특히 짝 요청) 개수 — 헤더에 빨간 점으로 표시.
  const [unreadChat, setUnreadChat] = useState(0);

  // Permission self-guard (per-club role, NOT the global gate)
  const [roleState, setRoleState] = useState<RoleState>('loading');

  // Staging tray (build a new queued game)
  const [staged, setStaged] = useState<string[]>([]);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestUnavailable, setSuggestUnavailable] = useState(false);
  // 자동 추천 모드 칩 표시 여부 (🎲 자동 추천 탭 시 토글).
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const bounceAnims = useRef([0, 1, 2, 3].map(() => new RNAnimated.Value(1))).current;

  // Modals
  const [guestModal, setGuestModal] = useState(false);
  const [feeModal, setFeeModal] = useState(false);
  const [courtModal, setCourtModal] = useState(false);
  // Matchup popup: the player whose "오늘 함께 친 사람" sheet is open (null = closed).
  const [matchupTarget, setMatchupTarget] = useState<{ userId: string; name: string; isGuest?: boolean } | null>(null);

  // Swap: { entryId, slotIndex } of the queued-game slot being replaced
  const [swapTarget, setSwapTarget] = useState<{ entryId: string; slotIndex: number } | null>(null);
  // Assign: entryId awaiting a court pick
  const [assignTarget, setAssignTarget] = useState<string | null>(null);

  // Which queued game card is currently in EDIT mode (controls expanded).
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // ─── Drag-to-compose: drop-target registry + active drag overlay ───
  const dropTargets = useRef<Map<string, DropTarget>>(new Map());
  const registerDrop = useCallback((t: DropTarget) => {
    dropTargets.current.set(t.id, t);
  }, []);
  const unregisterDrop = useCallback((id: string) => {
    dropTargets.current.delete(id);
  }, []);
  // The player being dragged out of the pool + its current finger position.
  const [poolDrag, setPoolDrag] = useState<{ userId: string; name: string; skill?: string; x: number; y: number } | null>(null);
  const [hoverDropId, setHoverDropId] = useState<string | null>(null);
  const poolDragRef = useRef<{ userId: string } | null>(null);
  // Set true once a pool drag has actually moved (so release can tell a drag
  // from a tap). Shared between the web window listeners and the card release.
  const poolMovedRef = useRef(false);

  // ─── Queue-card reorder drag (drag a whole 다음 게임 card up/down) ───
  // The WHOLE card is the drag trigger (press + move past threshold). A
  // full card-shaped copy is lifted under the finger/cursor; the remaining
  // cards animate (Animated translateY) to OPEN A CARD-SIZED GAP at the
  // insertion index so it visibly looks like the card will slot in there.
  // On release we resolve the insertion index and call moveQueueItem(from, to).
  const [queueDrag, setQueueDrag] = useState<
    {
      entryId: string; fromIdx: number;
      // The lifted card's own size + grab offset so the floating copy sits
      // exactly under the finger and is a real card, not a tiny pill.
      width: number; height: number; grabX: number; grabY: number;
      x: number; y: number;
    } | null
  >(null);
  // The INSERTION index (0..n) the dragged card currently targets. Drives the
  // gap animation: cards at/after this index slide down to open a card-sized
  // gap. null = no active queue-card drag.
  const [queueInsertIdx, setQueueInsertIdx] = useState<number | null>(null);
  const queueDragRef = useRef<{ entryId: string; fromIdx: number } | null>(null);
  const queueMovedRef = useRef(false);
  // resolveQueueDrop kept in a ref so the web window listeners (bound once at
  // drag start) always call the latest version (assigned just below).
  const resolveQueueDropRef = useRef<(fromIdx: number, x: number, y: number) => void>(() => {});
  // Per-card persistent Animated.Value for the gap-open translateY, keyed by
  // entry id (survives re-renders). The dragged card's measured height is the
  // gap size so the opening slot is exactly card-sized.
  const queueShiftAnims = useRef<Map<string, RNAnimated.Value>>(new Map()).current;
  const getQueueShift = useCallback((entryId: string) => {
    let v = queueShiftAnims.get(entryId);
    if (!v) { v = new RNAnimated.Value(0); queueShiftAnims.set(entryId, v); }
    return v;
  }, [queueShiftAnims]);
  // Height of the card being dragged = size of the gap to open. Stored in a ref
  // so the move handler (bound once at drag start) can read it without re-render.
  const queueGapHRef = useRef(0);
  // computeQueueShifts kept in a ref so the move handlers always call the latest
  // version (it closes over queuedEntries; assigned just below where defined).
  const computeQueueShiftsRef = useRef<(fromIdx: number, insertIdx: number) => void>(() => {});

  // Hit-test the registered drop targets at a point. `kindFilter` (optional)
  // restricts the search to one or more DropKinds. Pool drags pass
  // ['tray','queue'] so they never match a 'queue-card' reorder target, and the
  // queue-card reorder drag passes 'queue-card' so it only matches cards.
  const hitTestDrop = useCallback((pageX: number, pageY: number, kindFilter?: DropKind | DropKind[]): DropTarget | null => {
    const kinds = kindFilter == null ? null : Array.isArray(kindFilter) ? kindFilter : [kindFilter];
    let hit: DropTarget | null = null;
    for (const t of dropTargets.current.values()) {
      if (kinds && !kinds.includes(t.kind)) continue;
      const { x, y, w, h } = t.rect;
      if (pageX >= x && pageX <= x + w && pageY >= y && pageY <= y + h) { hit = t; break; }
    }
    return hit;
  }, []);

  // Keep a ref to resolveDrop so the web pointer listeners (bound once at drag
  // start) always call the latest version. Assigned just below where defined.
  const resolveDropRef = useRef<(userId: string, x: number, y: number) => void>(() => {});

  // WEB drag controller: drives a CONFIRMED drag (movement already detected by
  // the caller) with window-level pointer listeners until release, then resolves
  // the drop. Tap is NOT handled here — it's a plain onPress on the card — so a
  // no-move pointerup is a harmless no-op and can never get stuck.
  // (Native keeps using PanResponder; it calls this on grant from a move.)
  const beginPoolDrag = useCallback((
    userId: string, name: string, skill: string | undefined,
    startX: number, startY: number,
  ) => {
    poolDragRef.current = { userId };
    poolMovedRef.current = true; // begun only after movement confirmed
    setHoverDropId(null);
    setPoolDrag({ userId, name, skill, x: startX, y: startY });
    if (Platform.OS !== 'web') return;
    const w = window as any;
    const onMove = (ev: PointerEvent) => {
      const x = ev.pageX; const y = ev.pageY;
      poolMovedRef.current = true;
      setPoolDrag((prev) => (prev ? { ...prev, x, y } : prev));
      const hit = hitTestDrop(x, y, ['tray', 'queue']);
      setHoverDropId(hit ? hit.id : null);
    };
    const onUp = (ev: PointerEvent) => {
      w.removeEventListener('pointermove', onMove, true);
      w.removeEventListener('pointerup', onUp, true);
      const dragged = poolDragRef.current?.userId;
      const moved = poolMovedRef.current;
      poolDragRef.current = null;
      setPoolDrag(null);
      setHoverDropId(null);
      if (!dragged) return;
      // Resolve the drop at the release point (drag already confirmed on web).
      if (moved) resolveDropRef.current(dragged, ev.pageX, ev.pageY);
    };
    w.addEventListener('pointermove', onMove, true);
    w.addEventListener('pointerup', onUp, true);
  }, [hitTestDrop]);

  // Compute the INSERTION index (0..n) for a release/hover point by comparing the
  // cursor's Y against each registered queue-card rect midpoint. This is what
  // drives both the live gap animation and the final drop. Independent of which
  // card is hit so it works in the gap between cards too.
  const queueInsertIndexAt = useCallback((pageY: number): number => {
    const cards: DropTarget[] = [];
    for (const t of dropTargets.current.values()) {
      if (t.kind === 'queue-card') cards.push(t);
    }
    if (cards.length === 0) return 0;
    cards.sort((a, b) => a.slotIndex - b.slotIndex);
    // Above the first card's middle → index 0; else find first card whose
    // midpoint is below the cursor → insert before it; past the last → append.
    for (const c of cards) {
      const mid = c.rect.y + c.rect.h / 2;
      if (pageY < mid) return c.slotIndex;
    }
    return cards.length;
  }, []);

  // WEB queue-card reorder controller. A CONFIRMED drag (movement already
  // detected by the card-body pointerdown bootstrap) is driven by window pointer
  // listeners until release; on each move it recomputes the insertion index and
  // animates the card-sized gap, then on release resolves via moveQueueItem.
  // Native uses a PanResponder on the card body that claims on move + calls this.
  const beginQueueDrag = useCallback((
    entryId: string, fromIdx: number,
    cardW: number, cardH: number, grabX: number, grabY: number,
    startX: number, startY: number,
  ) => {
    queueDragRef.current = { entryId, fromIdx };
    queueMovedRef.current = true;
    queueGapHRef.current = cardH;
    setQueueInsertIdx(fromIdx);
    computeQueueShiftsRef.current(fromIdx, fromIdx);
    setQueueDrag({ entryId, fromIdx, width: cardW, height: cardH, grabX, grabY, x: startX, y: startY });
    if (Platform.OS !== 'web') return;
    const w = window as any;
    const onMove = (ev: PointerEvent) => {
      const x = ev.pageX; const y = ev.pageY;
      queueMovedRef.current = true;
      setQueueDrag((prev) => (prev ? { ...prev, x, y } : prev));
      const insert = queueInsertIndexAt(y);
      setQueueInsertIdx(insert);
      computeQueueShiftsRef.current(fromIdx, insert);
    };
    const onUp = (ev: PointerEvent) => {
      w.removeEventListener('pointermove', onMove, true);
      w.removeEventListener('pointerup', onUp, true);
      const drag = queueDragRef.current;
      const moved = queueMovedRef.current;
      queueDragRef.current = null;
      setQueueDrag(null);
      setQueueInsertIdx(null);
      if (!drag) return;
      if (moved) resolveQueueDropRef.current(drag.fromIdx, ev.pageX, ev.pageY);
    };
    w.addEventListener('pointermove', onMove, true);
    w.addEventListener('pointerup', onUp, true);
  }, [queueInsertIndexAt]);

  // ─── Load session meta (facilityId, clubId) + permission ───
  useEffect(() => {
    if (!clubSessionId) return;
    let alive = true;
    api.get(`/club-sessions/${clubSessionId}`).then(async ({ data }) => {
      if (!alive) return;
      setFacilityId(data?.facilityId);
      setClubName(data?.clubName || '');
      setClubId(data?.clubId);

      // per-club role check
      try {
        const { data: members } = await clubApi.getMembers(data.clubId);
        if (!alive) return;
        const me = (members || []).find((m: any) => m.userId === user?.id);
        const ok = me?.role === 'LEADER' || me?.role === 'STAFF';
        setRoleState(ok ? 'allowed' : 'denied');
      } catch {
        if (alive) setRoleState('denied');
      }
    }).catch(() => {
      if (alive) setRoleState('denied');
    });
    return () => { alive = false; };
  }, [clubSessionId, user?.id]);

  // ─── Load courts + players (per-정모 scoped) ───
  // Courts come from THIS 정모's courtIds (not the whole facility), so each
  // operator only sees/assigns to their own courts. Pool is session-scoped so
  // only THIS 정모's checked-in players show (not the whole facility).
  const loadCourts = useCallback(() => {
    if (!clubSessionId) return Promise.resolve();
    return api.get(`/club-sessions/${clubSessionId}/courts`)
      .then(({ data }) => setCourts(data || []))
      .catch(() => {});
  }, [clubSessionId]);

  const loadPool = useCallback(() => {
    if (!clubSessionId) return;
    Promise.all([
      loadCourts(),
      api.get(`/club-sessions/${clubSessionId}/players`).then(({ data }) => setPlayers(data || [])),
    ]).catch(() => {});
  }, [clubSessionId, loadCourts]);

  useEffect(() => { loadPool(); }, [loadPool]);

  // ─── Real-time: join facility room, refresh pool/board on relevant events ───
  useFacilityRoom(facilityId);
  const handleRealtime = useCallback(() => {
    loadPool();
    loadBoard();
  }, [loadPool, loadBoard]);
  useSocketEvent('players:updated', handleRealtime);
  useSocketEvent('checkin:arrived', handleRealtime);
  useSocketEvent('checkin:left', handleRealtime);
  useSocketEvent('turn:completed', handleRealtime);
  useSocketEvent('turn:started', handleRealtime);
  useSocketEvent('clubSession:courtsUpdated', handleRealtime);
  // Queue + board real-time events (previously missing → operator queue/court
  // states only updated on the poll). All emitted to the facility room.
  useSocketEvent('gameBoard:entryAdded', handleRealtime);
  useSocketEvent('gameBoard:entryPushed', handleRealtime);
  useSocketEvent('gameBoard:entryUpdated', handleRealtime);
  useSocketEvent('gameBoard:entryRemoved', handleRealtime);
  useSocketEvent('gameBoard:reordered', handleRealtime);
  useSocketEvent('turn:created', handleRealtime);
  useSocketEvent('turn:promoted', handleRealtime);
  useSocketEvent('turn:cancelled', handleRealtime);
  useSocketEvent('court:statusChanged', handleRealtime);

  // ─── 채팅/건의 실시간: 이 모임 룸에 참여, 새 메시지가 오면 헤더에 미확인 표시 ───
  useClubRoom(clubId);
  const handleClubMessage = useCallback((msg: any) => {
    if (clubId && msg?.clubId === clubId) setUnreadChat((n) => n + 1);
  }, [clubId]);
  useSocketEvent('clubMessage:new', handleClubMessage);

  // ─── Ensure board exists ───
  useEffect(() => {
    if (roleState === 'allowed' && !board && !loading && clubSessionId && !error) {
      createBoard().catch(() => {});
    }
  }, [roleState, board, loading, clubSessionId, error]);

  // ─── Derived: entries ───
  // QUEUED = court-less global "다음 게임" queue (courtId === null), ordered by queueOrder.
  const queuedEntries = useMemo<GameBoardEntry[]>(
    () => (board?.entries || [])
      .filter((e) => e.status === 'QUEUED' && !e.courtId)
      .sort((a, b) => a.queueOrder - b.queueOrder),
    [board],
  );
  // When the queue order/membership changes from the server (after a persisted
  // reorder, add, remove, …) AND no drag is in flight, snap every gap-shift back
  // to 0 so the new order renders flat, and prune anim values for gone entries.
  const queueOrderKey = useMemo(() => queuedEntries.map((e) => e.id).join('|'), [queuedEntries]);
  useEffect(() => {
    if (queueDragRef.current) return; // mid-drag: keep the live gap
    const ids = new Set(queuedEntries.map((e) => e.id));
    queueShiftAnims.forEach((v, id) => {
      if (!ids.has(id)) { queueShiftAnims.delete(id); return; }
      v.setValue(0);
    });
  }, [queueOrderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // On-court games (have a courtId, currently materialized/playing).
  const playingEntries = useMemo(
    () => (board?.entries || []).filter((e) => e.courtId && (e.status === 'PLAYING' || e.status === 'MATERIALIZED')),
    [board],
  );
  const playingByCourtId = useMemo(() => {
    const map = new Map<string, GameBoardEntry>();
    for (const entry of playingEntries) if (entry.courtId) map.set(entry.courtId, entry);
    return map;
  }, [playingEntries]);

  // SOFT double-booking flag set (server-computed).
  const busySet = useMemo(() => new Set(board?.busyPlayerIds || []), [board]);

  // Players already placed in a QUEUED game (대기 편성됨).
  const queuedPlayerIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of queuedEntries) for (const pid of e.playerIds) s.add(pid);
    return s;
  }, [queuedEntries]);

  // Dedupe by userId.
  const uniquePlayers = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) if (!map.has(p.userId)) map.set(p.userId, p);
    return Array.from(map.values());
  }, [players]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of uniquePlayers) map.set(p.userId, p);
    return map;
  }, [uniquePlayers]);
  const getPlayer = useCallback((id: string) => playerMap.get(id), [playerMap]);

  // ─── THREE POOL BOXES ───
  // 게임 중 — currently playing (status IN_TURN).
  // 대기 편성됨 — already placed in a queued game (and not playing).
  // 미편성 (대기) — checked-in, not playing, not in any queued game. Primary build pool.
  const { playingPool, queuedPool, freePool } = useMemo(() => {
    const sortByGames = (a: Player, b: Player) => (a.gamesPlayedToday ?? 0) - (b.gamesPlayedToday ?? 0);
    const playingP: Player[] = [];
    const queuedP: Player[] = [];
    const freeP: Player[] = [];
    for (const p of uniquePlayers) {
      if (p.status === 'IN_TURN') { playingP.push(p); continue; }
      if (queuedPlayerIds.has(p.userId)) { queuedP.push(p); continue; }
      freeP.push(p);
    }
    return {
      playingPool: playingP.sort(sortByGames),
      queuedPool: queuedP.sort(sortByGames),
      // 미편성: resting last, then fewest games first.
      freePool: freeP.sort((a, b) => {
        const ar = a.status === 'RESTING' ? 1 : 0;
        const br = b.status === 'RESTING' ? 1 : 0;
        if (ar !== br) return ar - br;
        return sortByGames(a, b);
      }),
    };
  }, [uniquePlayers, queuedPlayerIds]);

  const guestCount = useMemo(() => uniquePlayers.filter((p) => p.isGuest).length, [uniquePlayers]);

  // M/F balance over the 미편성 pool (who's free to build from).
  const genderCount = useMemo(() => {
    let male = 0;
    let female = 0;
    for (const p of freePool) {
      if (p.gender === 'M') male += 1;
      else if (p.gender === 'F') female += 1;
    }
    return { male, female };
  }, [freePool]);

  // Empty (assignable) courts.
  const emptyCourts = useMemo(
    () => courts.filter((c) => c.status === 'EMPTY' && !playingByCourtId.has(c.id)),
    [courts, playingByCourtId],
  );

  // ─── Composition flags (SOFT, calm — same tone as the conflict dot) ───
  // Surfaced from the board: a set of already-played/queued 4-player foursome
  // keys, and per-pair shared-game counts this 정모.
  const playedGroupSet = useMemo(
    () => new Set(board?.playedGroups || []),
    [board],
  );
  const pairCounts = useMemo(() => board?.pairCounts || {}, [board]);
  // The sorted "minId|maxId" key for a pair (matches the server's pairCounts key).
  const pairKey = useCallback((a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`), []);

  // When exactly 4 are staged, is this foursome a repeat of one already
  // played/queued this 정모? (informational — never blocks 대기등록.)
  const stagedGroupRepeat = useMemo(() => {
    if (staged.length !== 4) return false;
    const key = [...staged].sort().join('|');
    return playedGroupSet.has(key);
  }, [staged, playedGroupSet]);

  // Over-pairing hint: among the staged players, the pair that has shared the
  // most games this 정모 — surfaced only when that count is high (>= 2).
  const PAIR_HINT_THRESHOLD = 2;
  const stagedOverPair = useMemo(() => {
    if (staged.length < 2) return null;
    let best: { a: string; b: string; count: number } | null = null;
    for (let i = 0; i < staged.length; i += 1) {
      for (let j = i + 1; j < staged.length; j += 1) {
        const c = pairCounts[pairKey(staged[i], staged[j])] || 0;
        if (c >= PAIR_HINT_THRESHOLD && (!best || c > best.count)) {
          best = { a: staged[i], b: staged[j], count: c };
        }
      }
    }
    return best;
  }, [staged, pairCounts, pairKey]);

  // ─── Staging ───
  const toggleStaged = useCallback((userId: string) => {
    animateNext();
    setSuggestNote(null);
    setStaged((prev) => {
      if (prev.includes(userId)) return prev.filter((id) => id !== userId);
      if (prev.length >= 4) return prev;
      const nextIdx = prev.length;
      if (nextIdx < 4) {
        bounceAnims[nextIdx].setValue(0.5);
        RNAnimated.spring(bounceAnims[nextIdx], {
          toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
        }).start();
      }
      return [...prev, userId];
    });
  }, [bounceAnims]);

  const clearStaged = useCallback(() => {
    animateNext();
    setStaged([]);
    setSuggestNote(null);
  }, []);

  const prefillStaged = useCallback((ids: string[]) => {
    animateNext();
    const next = ids.slice(0, 4);
    setStaged(next);
    next.forEach((_, i) => {
      bounceAnims[i].setValue(0.5);
      RNAnimated.spring(bounceAnims[i], {
        toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
      }).start();
    });
  }, [bounceAnims]);

  // Place a player into a tray slot via drag-and-drop.
  //  - Already staged → no-op (avoid dupes).
  //  - Target slot occupied → replace that slot.
  //  - Target slot empty/beyond current length → append (first free slot).
  const placeStagedAt = useCallback((userId: string, slotIndex: number) => {
    animateNext();
    setSuggestNote(null);
    let landedAt = slotIndex;
    setStaged((prev) => {
      if (prev.includes(userId)) return prev;            // already in this game
      if (slotIndex < prev.length) {                     // replace an occupied slot
        const next = [...prev];
        next[slotIndex] = userId;
        return next;
      }
      if (prev.length >= 4) return prev;                 // full
      landedAt = prev.length;                            // append to first free
      return [...prev, userId];
    });
    if (landedAt < 4) {
      bounceAnims[landedAt].setValue(0.5);
      RNAnimated.spring(bounceAnims[landedAt], {
        toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
      }).start();
    }
  }, [bounceAnims]);

  // ─── Auto-suggest ───
  // mode 별 전략으로 다음 4인 추천 → 트레이 prefill + 안내문. mode 미지정 시 'fair'.
  const handleSuggest = useCallback(async (mode: SuggestMode = 'fair') => {
    setSuggestNote(null);
    setModeChooserOpen(false);
    try {
      const { playerIds, effectiveMode, note } = await suggestNext({ mode });
      if (!playerIds || playerIds.length < 4) {
        setSuggestNote('추천할 수 있는 인원이 부족해요 (최소 4명)');
        return;
      }
      prefillStaged(playerIds);
      // 서버가 실제 적용한 mode 의 안내문 사용(mixed→fair 대체 시 fair 문구).
      const applied = effectiveMode ?? mode;
      const meta = SUGGEST_MODES.find((m) => m.mode === applied);
      setSuggestNote(note ?? meta?.note ?? null);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setSuggestUnavailable(true);
        setSuggestNote('자동 추천 기능 준비 중이에요');
      } else {
        setSuggestNote(err?.response?.data?.error || '추천에 실패했어요');
      }
    }
  }, [suggestNext, prefillStaged]);

  // ─── 다음 게임 추가 (큐에 등록) ───
  const handleAddToQueue = useCallback(async () => {
    // Allow drafting a PARTIAL game (2 or 3 players); it can be filled to 4
    // later via the edit/swap flow. The backend accepts 1–4 players.
    if (staged.length < 2) { showAlert('알림', '최소 2명을 선택해주세요'); return; }
    try {
      await createQueueGame(staged);
      loadBoard();
      showSuccess(staged.length < 4 ? `다음 게임 큐에 추가! (${staged.length}명 · 나중에 채우기)` : '다음 게임 큐에 추가!');
      setStaged([]);
      setSuggestNote(null);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '등록 실패');
    }
  }, [staged, createQueueGame, loadBoard]);

  // ─── 큐 순서 변경 (▲▼ / 드래그) ───
  const moveQueueItem = useCallback(async (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= queuedEntries.length || fromIdx === toIdx) return;
    const ids = queuedEntries.map((e) => e.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    try {
      await reorderQueue(ids);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '순서 변경 실패');
      loadBoard();
    }
  }, [queuedEntries, reorderQueue, loadBoard]);

  // ─── 큐 게임을 코트에 배정 ───
  const handleAssign = useCallback(async (entryId: string, courtId: string) => {
    const court = courts.find((c) => c.id === courtId);
    try {
      await assignEntry(entryId, courtId);
      setAssignTarget(null);
      loadBoard();
      loadCourts();
      loadPool();
      showSuccess(`${court?.name || '코트'}에 배정!`);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '배정 실패');
    }
  }, [courts, assignEntry, loadBoard, loadCourts, loadPool]);

  // Tap an empty court → assign the first ASSIGNABLE queued game onto it. A
  // game is assignable with 2–4 players (단식 2 / 복식 3–4 / 부분 편성). Only a
  // 1-player draft can't materialize; the server returns the friendly hint.
  const handleAssignToCourt = useCallback((courtId: string) => {
    if (queuedEntries.length === 0) return;
    const firstAssignable = queuedEntries.find((e) => e.playerIds.length >= 2);
    if (!firstAssignable) {
      showAlert('알림', '2명 이상이어야 배정할 수 있어요');
      return;
    }
    handleAssign(firstAssignable.id, courtId);
  }, [queuedEntries, handleAssign]);

  // ─── 게임 종료 (코트 위 게임 턴 완료) ───
  const handleEndGame = useCallback(
    (courtId: string) => {
      const court = courts.find((c) => c.id === courtId);
      // Prefer the board entry's turnId; fall back to the court's currentTurn
      // (games created directly have no GameBoardEntry).
      const turnId = playingByCourtId.get(courtId)?.turnId ?? court?.currentTurn?.id ?? null;
      if (!turnId) {
        showAlert('알림', '이 코트에서 진행 중인 게임 정보를 찾을 수 없어요.');
        return;
      }
      showConfirm(
        '게임 종료',
        `${court?.name || '코트'}의 게임을 종료할까요?`,
        async () => {
          try {
            await clubSessionApi.completeTurn(turnId);
            loadBoard();
            loadCourts();
            loadPool();
            showSuccess('게임 종료!');
          } catch (err: any) {
            showAlert('오류', err.response?.data?.error || '종료 실패');
          }
        },
        '종료', '취소', 'danger',
      );
    },
    [playingByCourtId, courts, loadBoard, loadCourts, loadPool],
  );

  const handleDeleteQueued = useCallback(
    (entryId: string) =>
      showConfirm('삭제', '이 대기 게임을 삭제할까요?', async () => {
        try {
          await deleteEntry(entryId);
          loadBoard();
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '삭제 실패');
        }
      }, '삭제', '취소', 'danger'),
    [deleteEntry, loadBoard],
  );

  // ─── 정모 종료 (end the whole session) ───
  // Confirms, ends the session on the server, then navigates back out of the
  // operate board. Surfaces any server error instead of crashing.
  const handleEndSession = useCallback(() => {
    if (!clubSessionId) return;
    showConfirm(
      '정모 종료',
      '정모를 종료할까요? 모든 대기/게임이 정리됩니다.',
      async () => {
        try {
          await clubSessionApi.end(clubSessionId);
          setCourtModal(false);
          showSuccess('정모를 종료했어요');
          // After ending, show the operator the recap report.
          router.replace(`/session/${clubSessionId}/summary`);
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '정모 종료에 실패했어요');
        }
      },
      '종료', '취소', 'danger',
    );
  }, [clubSessionId, router]);

  // ─── 출석 링크 복사 ───
  // QR 화면을 열지 않고도 출석 링크(payload)를 바로 클립보드에 복사해 카톡 등에
  // 붙여넣을 수 있게 한다. (GET /club-sessions/:id/qr → payload)
  const [copyingLink, setCopyingLink] = useState(false);
  const copyAttendLink = useCallback(async () => {
    if (!clubSessionId || copyingLink) return;
    setCopyingLink(true);
    try {
      const { data } = await clubSessionApi.getSessionQr(clubSessionId);
      const link = data?.payload;
      if (!link) {
        showError('출석 링크를 불러오지 못했어요');
        return;
      }
      const ok = await copyToClipboard(link);
      if (ok) showSuccess('출석 링크 복사됨');
      else showError('복사하지 못했어요');
    } catch (err: any) {
      showError(err?.response?.data?.error || '출석 링크를 불러오지 못했어요');
    } finally {
      setCopyingLink(false);
    }
  }, [clubSessionId, copyingLink]);

  // ─── 운영자: 특정 참가자를 정모에서 체크아웃 ───
  // Self-checkout과 동일한 정리를 서버에서 수행. 성공 시 모달을 닫고 풀/보드를
  // 갱신(소켓 players:updated 도 함께 갱신). 실수 방지를 위해 확인 단계를 둠.
  const handleOperatorCheckout = useCallback(
    (targetUserId: string, targetName: string) => {
      if (!clubSessionId) return;
      showConfirm(
        '체크아웃 시키기',
        `${targetName}님을 정모에서 체크아웃할까요? 대기 중인 순번은 취소되고 출석 목록에서 제거됩니다.`,
        async () => {
          try {
            await clubSessionApi.checkoutPlayer(clubSessionId, targetUserId);
            setMatchupTarget(null);
            loadPool();
            loadBoard();
            showSuccess(`${targetName}님 체크아웃 완료`);
          } catch (err: any) {
            showAlert('오류', err?.response?.data?.error || '체크아웃에 실패했어요');
          }
        },
        '체크아웃',
        '취소',
        'danger',
      );
    },
    [clubSessionId, loadPool, loadBoard],
  );

  // ─── 플레이어 교체 (큐 게임의 한 슬롯을 다른 사람으로) ───
  const handleSwapPlayer = useCallback(async (replacementId: string) => {
    if (!swapTarget) return;
    const entry = queuedEntries.find((e) => e.id === swapTarget.entryId);
    if (!entry) { setSwapTarget(null); return; }
    const nextIds = [...entry.playerIds];
    const existingIdx = nextIds.indexOf(replacementId);
    // Tapping an EMPTY slot (slotIndex >= current length) ADDS the player
    // (filling a partial 2–3 player game toward 4); otherwise replace/swap.
    const isAdd = swapTarget.slotIndex >= nextIds.length;
    if (isAdd) {
      if (existingIdx < 0) nextIds.push(replacementId); // ignore if already in game
    } else if (existingIdx >= 0) {
      const tmp = nextIds[swapTarget.slotIndex];
      nextIds[swapTarget.slotIndex] = nextIds[existingIdx];
      nextIds[existingIdx] = tmp;
    } else {
      nextIds[swapTarget.slotIndex] = replacementId;
    }
    try {
      await updateEntry(entry.id, nextIds);
      setSwapTarget(null);
      loadBoard();
      showSuccess(isAdd ? '추가 완료!' : '교체 완료!');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || (isAdd ? '추가 실패' : '교체 실패'));
    }
  }, [swapTarget, queuedEntries, updateEntry, loadBoard]);

  // ─── Drag-drop a pool player onto a queued game slot (replace) ───
  const handleDropOnQueueSlot = useCallback(async (entryId: string, slotIndex: number, replacementId: string) => {
    const entry = queuedEntries.find((e) => e.id === entryId);
    if (!entry) return;
    if (entry.playerIds[slotIndex] === replacementId) return;
    const nextIds = [...entry.playerIds];
    const existingIdx = nextIds.indexOf(replacementId);
    // Dropping onto an EMPTY slot ADDS (fills a partial game); else replace/swap.
    const isAdd = slotIndex >= nextIds.length;
    if (isAdd) {
      if (existingIdx < 0) nextIds.push(replacementId);
    } else if (existingIdx >= 0) {
      const tmp = nextIds[slotIndex];
      nextIds[slotIndex] = nextIds[existingIdx];
      nextIds[existingIdx] = tmp;
    } else {
      nextIds[slotIndex] = replacementId;
    }
    try {
      await updateEntry(entryId, nextIds);
      loadBoard();
      showSuccess(isAdd ? '추가 완료!' : '교체 완료!');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || (isAdd ? '추가 실패' : '교체 실패'));
    }
  }, [queuedEntries, updateEntry, loadBoard]);

  // ─── Resolve a drop (called on pool-drag release) ───
  const resolveDrop = useCallback((userId: string, pageX: number, pageY: number) => {
    const hit = hitTestDrop(pageX, pageY, ['tray', 'queue']);
    if (!hit) return;
    if (hit.kind === 'tray') {
      placeStagedAt(userId, hit.slotIndex);
    } else if (hit.kind === 'queue' && hit.entryId) {
      handleDropOnQueueSlot(hit.entryId, hit.slotIndex, userId);
    }
  }, [hitTestDrop, placeStagedAt, handleDropOnQueueSlot]);
  resolveDropRef.current = resolveDrop;

  // ─── Animate the card-sized gap open/closed for a given hover state ───
  // Given the dragged card's original index `fromIdx` and the current INSERTION
  // index `insertIdx` (0..n), translate every OTHER card so a card-sized gap
  // opens exactly at the insertion point. Uniform card height (the dragged
  // card's measured height) is used as the gap size, which is exact for the
  // collapsed rows that dominate the queue. The math (with the source removed):
  //   shift(i) = (i >= insertIdx ? +gapH : 0) − (i > fromIdx ? +gapH : 0)
  // i.e. cards at/after the gap move down, cards that were below the lifted card
  // move up to fill its vacated space, and the two cancel below the gap.
  const computeQueueShifts = useCallback((fromIdx: number, insertIdx: number) => {
    const gapH = queueGapHRef.current || 64;
    queuedEntries.forEach((e, i) => {
      const v = getQueueShift(e.id);
      let target = 0;
      if (i !== fromIdx) {
        if (i >= insertIdx) target += gapH;
        if (i > fromIdx) target -= gapH;
      }
      RNAnimated.spring(v, {
        toValue: target,
        useNativeDriver: true,
        friction: 12, tension: 140,
      }).start();
    });
  }, [queuedEntries, getQueueShift]);
  computeQueueShiftsRef.current = computeQueueShifts;

  // Settle all cards back to 0 (gap closed). Used on drop/cancel so the list
  // resolves smoothly into its new order.
  const settleQueueShifts = useCallback(() => {
    queueShiftAnims.forEach((v) => {
      RNAnimated.spring(v, { toValue: 0, useNativeDriver: true, friction: 12, tension: 140 }).start();
    });
  }, [queueShiftAnims]);

  // ─── Resolve a queue-card reorder drop (called on queue-card drag release) ───
  // Compute the insertion index from the release Y; if it maps to a different
  // position, persist via moveQueueItem (→ reorderQueue → PATCH
  // /game-boards/:id/queue/reorder), which also refreshes the board. Always
  // settle the gap animations closed so the list resolves smoothly.
  const resolveQueueDrop = useCallback((fromIdx: number, pageX: number, pageY: number) => {
    const insertIdx = queueInsertIndexAt(pageY);
    settleQueueShifts();
    // An insertion index in 0..n maps to a destination row. Inserting at a
    // position after the source shifts left by one once the source is removed.
    let toIdx = insertIdx;
    if (insertIdx > fromIdx) toIdx -= 1;
    if (toIdx < 0) toIdx = 0;
    if (toIdx > queuedEntries.length - 1) toIdx = queuedEntries.length - 1;
    if (toIdx !== fromIdx) moveQueueItem(fromIdx, toIdx);
  }, [queueInsertIndexAt, settleQueueShifts, moveQueueItem, queuedEntries.length]);
  resolveQueueDropRef.current = resolveQueueDrop;

  // ─── Permission states ───
  if (roleState === 'loading' || (roleState === 'allowed' && loading && !board)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (roleState === 'denied') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.denied}>
          <Icon name="leader" size={40} color={colors.textLight} />
          <Text style={[styles.deniedTitle, { color: colors.text }]}>운영 권한이 없습니다</Text>
          <Text style={[styles.deniedSub, { color: colors.textSecondary }]}>
            모임의 대표 또는 운영진만 운영판을 사용할 수 있어요.
          </Text>
          <TouchableOpacity
            style={[styles.deniedBtn, { backgroundColor: colors.primary }]}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          >
            <Text style={styles.deniedBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const stagedSet = new Set(staged);

  // ─────────────────────────────────────────────────────────
  // Shared sub-renderers
  // ─────────────────────────────────────────────────────────

  // COMPACT 급수 mark: a tiny rounded square showing the colored 급수 letter
  // (S/A/B/C/D/E/F) on a thin colored border — replaces the old heavy filled
  // circle so chips/tiles get smaller while the level stays clearly readable.
  const SkillTag = ({ level, size = 'md' }: { level?: string; size?: 'sm' | 'md' }) => {
    const skill = getSkillMeta(level);
    const dim = size === 'sm' ? 16 : 18;
    return (
      <View style={[
        styles.skillTag,
        { width: dim, height: dim, borderColor: skill.color, backgroundColor: colors.surface },
      ]}>
        <Text style={[styles.skillTagText, { color: skill.color, fontSize: size === 'sm' ? 10 : 11 }]}>
          {(level || '·').toUpperCase()}
        </Text>
      </View>
    );
  };

  // Game-type label (남복/여복/혼복) computed from the 4 players' genders.
  // CALM but VISIBLE: a small text label whose TEXT is tinted by the game type
  // (혼복=violet · 남복=blue · 여복=rose) — color comes from getGameType's theme
  // color key. NO colored badge / tint / accent rail — just colored text so the
  // type is instantly readable without shouting. Hidden for neutral (incomplete).
  const GameTypeLabel = ({ playerIds }: { playerIds: string[] }) => {
    const genders = [0, 1, 2, 3].map((i) => getPlayer(playerIds[i])?.gender);
    const t = getGameType(genders);
    if (t.type === 'neutral') return null;
    return (
      <Text style={[styles.typeLabel, { color: colors[t.colorKey] }]}>{t.label}</Text>
    );
  };

  // One LEGIBLE player chip for an on-court / queued game: 급수 avatar (letter),
  // FULL Korean name (≥13px, never 2-char truncated), gender marker (♂/♀), and
  // "N게임". Laid out in a 2×2 grid by the parent. Names won't clip for 2–4 char
  // Korean names; a graceful single-line ellipsis only kicks in for very long ones.
  const GamePlayerChip = ({
    pId, name, busy, onPress, accessibilityLabel,
  }: {
    pId?: string;
    name?: string;
    busy?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => {
    const p = pId ? getPlayer(pId) : null;
    const skill = getSkillMeta(p?.skillLevel);
    const g = getGenderMeta(p?.gender);
    const display = p?.userName || name;
    const body = (
      <>
        <View style={[styles.skillTag, { borderColor: skill.color, backgroundColor: colors.surface }]}>
          <Text style={[styles.skillTagText, { color: skill.color, fontSize: 11 }]}>
            {(p?.skillLevel || '·').toUpperCase()}
          </Text>
        </View>
        <View style={styles.gameChipBody}>
          <View style={styles.gameChipNameRow}>
            <Text
              style={[styles.gameChipName, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {display || '?'}
            </Text>
            {g && (
              <Text style={[styles.gameChipGenderText, { color: g.color }]}>{g.symbol}</Text>
            )}
          </View>
          <Text style={[styles.gameChipGames, { color: colors.textSecondary }]} numberOfLines={1}>
            {p?.gamesPlayedToday ?? 0}게임
          </Text>
        </View>
        {/* Double-booking is ALLOWED — never blocked. A small, subtle RED DOT in
            the top-right corner is the only conflict cue (informational). */}
        {busy && display && <View style={[styles.conflictDot, { borderColor: colors.surface }]} />}
      </>
    );
    // Double-booking is fully allowed and visually CALM: no red tint, no red
    // border, no ⚠ — just the small corner dot above.
    const chipStyle = [
      styles.gameChip,
      { borderColor: colors.border, backgroundColor: colors.surface },
    ];
    if (!display) {
      // Empty slot. In edit mode (onPress provided) it becomes a "+ 추가"
      // affordance so a partial 2–3 player game can be filled toward 4.
      if (onPress) {
        return (
          <TouchableOpacity
            style={[styles.gameChip, styles.gameChipEmpty, { borderColor: colors.primary }]}
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityLabel="빈 자리에 추가"
          >
            <Text style={[styles.gameChipEmptyText, { color: colors.primary }]}>+ 추가</Text>
          </TouchableOpacity>
        );
      }
      return (
        <View style={[styles.gameChip, styles.gameChipEmpty, { borderColor: colors.border }]}>
          <Text style={[styles.gameChipEmptyText, { color: colors.textLight }]}>빈 자리</Text>
        </View>
      );
    }
    if (onPress) {
      return (
        <TouchableOpacity style={chipStyle} onPress={onPress} activeOpacity={0.7} accessibilityLabel={accessibilityLabel}>
          {body}
        </TouchableOpacity>
      );
    }
    return <View style={chipStyle}>{body}</View>;
  };

  // One player tile in a pool box. Tap behavior depends on the box.
  //
  // RELIABILITY MODEL (web is the operator's primary platform):
  //  - TAP is the rock-solid PRIMARY path. The stageable PlayerCard always gets
  //    a plain `onPress` (toggleStaged). On web this is a real DOM click, so it
  //    can NEVER be swallowed by a gesture responder.
  //  - DRAG-to-compose is an ENHANCEMENT only, and is wired so it can never
  //    break a tap or leave the UI stuck:
  //      • web  → a wrapper onPointerDown starts a window-pointer drag ONLY once
  //               the finger moves past a threshold; a no-move pointerup does
  //               nothing here (the card's onPress already handled the tap).
  //      • native → PanResponder claims on move (not start) so a tap falls
  //               through to the PlayerCard's onPress.
  const PoolCard = ({ m, stageable }: { m: Player; stageable: boolean }) => {
    const isStaged = stagedSet.has(m.userId);
    // Any checked-in player can be composed into the next game regardless of
    // state — 미편성/대기, 휴식(RESTING), 대기 편성됨, 게임 중 모두 편성 가능.
    // (중복은 빨간 점만, 막지 않음 — 운영자가 판단.)
    const canTap = stageable;
    const draggable = stageable;
    const tap = canTap ? () => toggleStaged(m.userId) : undefined;
    // Double-booked (in another game's roster) → small subtle red dot only.
    const busy = busySet.has(m.userId);

    // NATIVE drag: claim the responder only on a real MOVE, so taps reach the
    // child TouchableOpacity (PlayerCard.onPress) untouched.
    const pan = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => draggable && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
        onPanResponderGrant: (e) => {
          beginPoolDrag(m.userId, m.userName, m.skillLevel, e.nativeEvent.pageX, e.nativeEvent.pageY);
        },
        onPanResponderMove: (e) => {
          if (Platform.OS === 'web') return;
          const { pageX, pageY } = e.nativeEvent;
          setPoolDrag((prev) => (prev ? { ...prev, x: pageX, y: pageY } : prev));
          const hit = hitTestDrop(pageX, pageY, ['tray', 'queue']);
          setHoverDropId(hit ? hit.id : null);
        },
        onPanResponderRelease: (e) => {
          if (Platform.OS === 'web') return; // handled by window pointerup
          const { pageX, pageY } = e.nativeEvent;
          const dragged = poolDragRef.current?.userId;
          poolDragRef.current = null;
          setPoolDrag(null);
          setHoverDropId(null);
          if (dragged) resolveDrop(dragged, pageX, pageY);
        },
        onPanResponderTerminate: () => {
          if (Platform.OS === 'web') return;
          poolDragRef.current = null;
          setPoolDrag(null);
          setHoverDropId(null);
        },
      }),
    ).current;

    // WEB drag: start a threshold-gated drag from a raw pointerdown WITHOUT
    // claiming any responder, so the card's onPress (tap) is never blocked. A
    // plain tap (no movement) simply never starts a drag.
    const onPointerDownWeb = useCallback((ev: any) => {
      if (Platform.OS !== 'web' || !draggable) return;
      if (ev.button != null && ev.button !== 0) return; // left/primary only
      const startX = ev.pageX; const startY = ev.pageY;
      let started = false;
      const w = window as any;
      const onMove = (e: PointerEvent) => {
        if (!started) {
          if (Math.abs(e.pageX - startX) <= 6 && Math.abs(e.pageY - startY) <= 6) return;
          started = true;
          // begin the visual drag now that movement is confirmed
          beginPoolDrag(m.userId, m.userName, m.skillLevel, e.pageX, e.pageY);
        }
        // beginPoolDrag installs its own move/up listeners; once started we let
        // those drive the rest. Detach this bootstrap listener.
        if (started) {
          w.removeEventListener('pointermove', onMove, true);
          w.removeEventListener('pointerup', onUp, true);
        }
      };
      const onUp = () => {
        w.removeEventListener('pointermove', onMove, true);
        w.removeEventListener('pointerup', onUp, true);
        // No movement → it was a tap; onPress handles it. Nothing to clean up.
      };
      w.addEventListener('pointermove', onMove, true);
      w.addEventListener('pointerup', onUp, true);
    }, [draggable, m.userId, m.userName, m.skillLevel]);

    // A small ⓘ info button overlaid in the tile's top-right corner. It's a
    // SEPARATE TouchableOpacity (sibling of the card) so tapping it opens the
    // matchup popup WITHOUT triggering the card's tap-to-stage. On web its
    // pointerdown is stopped so it never starts a pool drag either.
    const infoButton = (
      <TouchableOpacity
        style={[styles.infoBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
        onPress={() => setMatchupTarget({ userId: m.userId, name: m.userName, isGuest: m.isGuest })}
        hitSlop={6}
        accessibilityLabel={`${m.userName} 매치업 보기`}
        {...(Platform.OS === 'web'
          ? { onPointerDown: (e: any) => e.stopPropagation?.() }
          : {})}
      >
        <Icon name="info" size={13} color={colors.textSecondary} />
      </TouchableOpacity>
    );

    // Non-draggable boxes (게임 중 / 대기 편성됨) keep the plain tile.
    // Double-booking is allowed → no red "중복" badge / conflict tint.
    if (!draggable) {
      return (
        <View style={styles.poolCell}>
          <PlayerCard
            player={m}
            onPress={tap}
            stagedIndex={isStaged ? staged.indexOf(m.userId) + 1 : null}
            highlighted={isStaged}
            dimmed={!stageable && !isStaged}
            busy={busy}
          />
          {infoButton}
        </View>
      );
    }

    return (
      <View style={styles.poolCell} {...pan.panHandlers} {...(Platform.OS === 'web' ? { onPointerDown: onPointerDownWeb } : {})}>
        <PlayerCard
          player={m}
          onPress={tap}
          stagedIndex={isStaged ? staged.indexOf(m.userId) + 1 : null}
          highlighted={isStaged}
          busy={busy}
        />
        {infoButton}
      </View>
    );
  };

  // A labeled pool box (게임 중 / 대기 편성됨 / 미편성).
  const PoolBox = ({
    label, count, list, tint, stageable, emptyText,
  }: {
    label: string; count: number; list: Player[]; tint: string; stageable: boolean; emptyText: string;
  }) => (
    <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.poolBoxHeader}>
        <View style={[styles.poolBoxDot, { backgroundColor: tint }]} />
        <Text style={[styles.poolBoxLabel, { color: colors.text }]}>{label}</Text>
        <View style={[styles.poolBoxCount, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.poolBoxCountText, { color: colors.textSecondary }]}>{count}명</Text>
        </View>
      </View>
      {list.length === 0 ? (
        <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>{emptyText}</Text>
      ) : (
        <View style={styles.poolGrid}>
          {list.map((m) => <PoolCard key={m.userId} m={m} stageable={stageable} />)}
        </View>
      )}
    </View>
  );

  const PoolBoxes = (
    <>
      <PoolBox
        label="미편성 (대기)" count={freePool.length} list={freePool}
        tint={colors.playerAvailable} stageable emptyText="대기 중인 회원이 없어요"
      />
      {/* 대기 편성됨 / 게임 중 도 stageable — 이미 편성됐거나 게임 중인 사람도
          '미리 다음 게임'에 넣을 수 있어야 함(소프트 중복 = 빨간 점만, 막지 않음). */}
      <PoolBox
        label="대기 편성됨" count={queuedPool.length} list={queuedPool}
        tint={colors.info} stageable emptyText="아직 편성된 회원이 없어요"
      />
      <PoolBox
        label="게임 중" count={playingPool.length} list={playingPool}
        tint={colors.playerInTurn} stageable emptyText="진행 중인 게임이 없어요"
      />
    </>
  );

  // A single composable slot that registers itself as a drop target and shows
  // the seated player compactly (급수 avatar + name + 게임수). Used by both the
  // new-game tray and (in edit mode) queued game cards.
  const TraySlot = ({ i }: { i: number }) => {
    const ref = useRef<View>(null);
    const dropId = `tray-${i}`;
    const pId = staged[i];
    const p = pId ? getPlayer(pId) : null;
    const isHover = hoverDropId === dropId;

    const measure = useCallback(() => {
      ref.current?.measureInWindow((x, y, w, h) => {
        registerDrop({ id: dropId, kind: 'tray', slotIndex: i, rect: { x, y, w, h } });
      });
    }, [dropId, i]);

    useEffect(() => {
      const t = setTimeout(measure, 0);
      return () => { clearTimeout(t); unregisterDrop(dropId); };
    });

    return (
      <RNAnimated.View
        ref={ref}
        onLayout={measure}
        style={[
          styles.traySlot,
          {
            // Double-booking allowed → no red conflict tint. Calm states only.
            borderColor: isHover ? colors.primary : p ? colors.primary : colors.border,
            backgroundColor: isHover ? colors.primaryBg : p ? colors.primaryLight : colors.background,
            // NOTE: no scale bounce here — on web the native-driver spring that
            // returns scale 0.5→1 doesn't run, leaving the slot stuck at half size.
          },
          isHover && { borderWidth: 2 },
        ]}
      >
        {p ? (
          <TouchableOpacity style={styles.traySlotInner} onPress={() => toggleStaged(pId!)} activeOpacity={0.6}>
            <SkillTag level={p.skillLevel} size="sm" />
            <View style={styles.traySlotText}>
              <Text style={[styles.traySlotName, { color: colors.primary }]} numberOfLines={1}>
                {p.userName}
              </Text>
              <Text style={[styles.traySlotGames, { color: colors.textSecondary }]}>{p.gamesPlayedToday ?? 0}게임</Text>
            </View>
            <Text style={[styles.traySlotX, { color: colors.danger }]}>×</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.traySlotEmpty, { color: isHover ? colors.primary : colors.textLight }]}>
            {isHover ? '여기에 놓기' : `${i + 1}`}
          </Text>
        )}
      </RNAnimated.View>
    );
  };

  const Tray = () => (
    <View style={[styles.trayCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
      <Text style={[styles.trayHeading, { color: colors.text }]}>다음 게임 편성 · 2~4명 (드래그 또는 탭)</Text>
      <View style={styles.trayRow}>
        {[0, 1, 2, 3].map((i) => <TraySlot key={i} i={i} />)}
      </View>

      {suggestNote && (
        <Text style={[styles.suggestNote, { color: colors.warning }]}>{suggestNote}</Text>
      )}

      {/* SOFT composition hints — calm, informational, NEVER blocking. Same
          quiet tone as the conflict dot: a tiny dot + muted text, no alarm. */}
      {(stagedGroupRepeat || stagedOverPair) && (
        <View style={styles.compHints}>
          {stagedGroupRepeat && (
            <View style={styles.compHintRow}>
              <View style={[styles.compHintDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.compHintText, { color: colors.textSecondary }]}>이미 친 조합</Text>
            </View>
          )}
          {stagedOverPair && (
            <View style={styles.compHintRow}>
              <View style={[styles.compHintDot, { backgroundColor: colors.info }]} />
              <Text style={[styles.compHintText, { color: colors.textSecondary }]} numberOfLines={1}>
                {getPlayer(stagedOverPair.a)?.userName ?? '?'}·{getPlayer(stagedOverPair.b)?.userName ?? '?'} 자주 함께 ({stagedOverPair.count}번)
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.trayButtons}>
        <TouchableOpacity
          style={[
            styles.suggestBtn,
            {
              backgroundColor: suggestUnavailable ? colors.textLight : colors.info,
              opacity: modeChooserOpen ? 0.9 : 1,
            },
          ]}
          onPress={() => {
            if (suggestUnavailable) return;
            setSuggestNote(null);
            setModeChooserOpen((o) => !o);
          }}
          disabled={suggesting || suggestUnavailable}
          activeOpacity={0.85}
          accessibilityLabel="자동 추천"
        >
          {suggesting ? (
            <ActivityIndicator size="small" color={palette.white} />
          ) : (
            <Text style={styles.suggestBtnText}>
              {suggestUnavailable ? '준비 중' : `🎲 자동 추천${modeChooserOpen ? ' ▴' : ' ▾'}`}
            </Text>
          )}
        </TouchableOpacity>
        {staged.length > 0 && (
          <TouchableOpacity style={[styles.clearBtn, { borderColor: colors.border }]} onPress={clearStaged}>
            <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>초기화</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 매칭 모드 선택기 — 🎲 자동 추천 탭 시 펼쳐지는 칩 묶음. 칩 탭 → 해당 모드로 추천. */}
      {modeChooserOpen && !suggestUnavailable && (
        <View style={[styles.modeChooser, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[styles.modeChooserTitle, { color: colors.textSecondary }]}>
            어떻게 추천할까요?
          </Text>
          <View style={styles.modeChips}>
            {SUGGEST_MODES.map((m) => (
              <TouchableOpacity
                key={m.mode}
                style={[styles.modeChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => handleSuggest(m.mode)}
                disabled={suggesting}
                activeOpacity={0.8}
                accessibilityLabel={`${m.label} 추천`}
              >
                <Text style={[styles.modeChipLabel, { color: colors.text }]}>
                  {m.emoji} {m.label}
                </Text>
                <Text style={[styles.modeChipHint, { color: colors.textSecondary }]} numberOfLines={1}>
                  {m.hint}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[styles.registerBtn, { backgroundColor: staged.length >= 2 ? colors.primary : colors.textLight }]}
        onPress={handleAddToQueue}
        disabled={staged.length < 2}
        activeOpacity={0.85}
      >
        <Text style={styles.registerBtnText}>
          다음 게임 추가{staged.length > 0 && staged.length < 4 ? ` (${staged.length}/4)` : ''}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // A LEGIBLE player chip inside a queued game card: 급수 avatar + full name +
  // ♂/♀ + 게임수. Laid out in a 2×2 grid (styles.gameGrid). In edit mode the
  // chip becomes a drop target (drag a pool player onto it) and tapping it opens
  // the swap picker; in compact mode it's a read-only chip.
  const QueueSlot = ({ entry, slotIdx, editing }: { entry: GameBoardEntry; slotIdx: number; editing: boolean }) => {
    const ref = useRef<View>(null);
    const dropId = `q-${entry.id}-${slotIdx}`;
    const pId = entry.playerIds[slotIdx];
    const p = pId ? getPlayer(pId) : null;
    const name = p?.userName || entry.playerNames?.[slotIdx];
    const busy = pId ? busySet.has(pId) : false;
    const isHover = hoverDropId === dropId;

    const measure = useCallback(() => {
      if (!editing) return;
      ref.current?.measureInWindow((x, y, w, h) => {
        registerDrop({ id: dropId, kind: 'queue', entryId: entry.id, slotIndex: slotIdx, rect: { x, y, w, h } });
      });
    }, [dropId, slotIdx, editing, entry.id]);

    useEffect(() => {
      if (!editing) { unregisterDrop(dropId); return; }
      const t = setTimeout(measure, 0);
      return () => { clearTimeout(t); unregisterDrop(dropId); };
    });

    // Compact (read-only) chip.
    if (!editing) {
      return (
        <View style={styles.gameGridCell}>
          <GamePlayerChip pId={pId} name={name} busy={busy} />
        </View>
      );
    }

    // Edit mode: measured drop target + tap-to-swap, wrapping the same chip.
    return (
      <View
        ref={ref}
        onLayout={measure}
        collapsable={false}
        style={[
          styles.gameGridCell,
          isHover && { borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primaryBg },
        ]}
      >
        <GamePlayerChip
          pId={pId}
          name={name}
          busy={busy}
          onPress={() => setSwapTarget({ entryId: entry.id, slotIndex: slotIdx })}
          accessibilityLabel={`${name || ''} 교체`}
        />
      </View>
    );
  };

  // One player chip for a COLLAPSED queue row, now on its OWN line (4 across)
  // so each gets ~¼ of the full row width. A colored 급수 LETTER (S/A/B/C/D/E/F),
  // the player name (13px, full for KO names), and a ♂/♀ marker. Each chip
  // claims an equal share (flex:1) with comfortable spacing so the four names
  // never blur together; short KO names always show in full, and only a very
  // long (guest) name ellipsizes — within its own equal slot, never the others.
  const QueueMiniChip = ({ pId, name }: { pId?: string; name?: string }) => {
    const p = pId ? getPlayer(pId) : null;
    const skill = getSkillMeta(p?.skillLevel);
    const g = getGenderMeta(p?.gender);
    const display = p?.userName || name;
    const busy = pId ? busySet.has(pId) : false;
    if (!display) {
      return (
        <View style={[styles.miniChip, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[styles.miniChipEmpty, { color: colors.textLight }]}>·</Text>
        </View>
      );
    }
    // Double-booking allowed → render the chip calmly. The only conflict cue is
    // a small subtle RED DOT in the corner (informational, never blocking).
    return (
      <View
        style={[
          styles.miniChip,
          { borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
        ]}
      >
        <View style={[styles.miniChipSkill, { borderColor: skill.color, backgroundColor: colors.surface }]}>
          <Text style={[styles.miniChipSkillText, { color: skill.color }]}>
            {(p?.skillLevel || '·').toUpperCase()}
          </Text>
        </View>
        <Text
          style={[styles.miniChipName, { color: colors.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {display}
        </Text>
        {g && <Text style={[styles.miniChipGender, { color: g.color }]}>{g.symbol}</Text>}
        {busy && <View style={[styles.conflictDot, { borderColor: colors.surfaceSecondary }]} />}
      </View>
    );
  };

  // A queued (confirmed) game row in the "다음 게임" panel.
  // DEFAULT = COMPACT single-line row (≈44–52px): order # + type badge +
  //   4 inline mini-chips + 수정. So 7–8+ games are visible at once.
  // EDIT mode (수정) = expands into the editable 2×2 view: drag handle, ▲▼
  //   reorder, swap-on-tap, drop targets, 배정 / 삭제 controls.
  const QueueItem = ({ entry, idx }: { entry: GameBoardEntry; idx: number }) => {
    const isAssigning = assignTarget === entry.id;
    const editing = editingEntryId === entry.id;

    // ── Queue-card reorder drag (drag the WHOLE card up/down) ──
    // The entire card body is the drag trigger: press + move past a small
    // threshold lifts a full card-shaped copy under the finger, while the other
    // cards animate to open a card-sized gap at the insertion point. Inner
    // buttons (▲▼/수정/삭제/cocourt) still work because the drag is claimed on
    // MOVE (native onMoveShouldSet) / threshold (web pointerdown→move), never on
    // start — so a tap falls through to those buttons.
    const cardRef = useRef<View>(null);
    const cardDropId = `qcard-${entry.id}`;
    const isCardDragSource = queueDrag?.entryId === entry.id;
    // Persistent gap-open offset for THIS card (translateY).
    const shiftAnim = getQueueShift(entry.id);
    // Latest measured rect of this card (for the lifted-copy geometry on grant).
    const cardRectRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

    const measureCard = useCallback(() => {
      // Don't re-measure mid-drag: cards are translated by the gap animation, so
      // measureInWindow would return shifted positions and corrupt the rects the
      // insertion-index math relies on. The resting rects captured before the
      // drag stay valid (the list itself doesn't reflow until the drop persists).
      if (queueDragRef.current) return;
      cardRef.current?.measureInWindow((x, y, w, h) => {
        cardRectRef.current = { x, y, w, h };
        registerDrop({ id: cardDropId, kind: 'queue-card', entryId: entry.id, slotIndex: idx, rect: { x, y, w, h } });
      });
    }, [cardDropId, idx, entry.id]);

    // Re-measure/register every render (cheap; keeps rects fresh as the list
    // changes) — BUT skip the work entirely while a drag is in flight: the
    // measure is guarded (cards are translated mid-drag) and, crucially, the
    // cleanup must NOT unregister during a drag or it would wipe the resting
    // rects the insertion-index math relies on between a move and the drop.
    useEffect(() => {
      if (queueDragRef.current) return;          // mid-drag: leave rects intact
      const t = setTimeout(measureCard, 0);
      return () => {
        clearTimeout(t);
        if (!queueDragRef.current) unregisterDrop(cardDropId);
      };
    });

    // Kick off the lifted-card drag from a confirmed press point, supplying the
    // card's size + the grab offset so the floating copy sits under the finger.
    // `idx` can change after a reorder while the once-created PanResponder keeps
    // its first closure, so the trigger reads the live idx from a ref.
    const idxRef = useRef(idx);
    idxRef.current = idx;
    const startCardDrag = useCallback((pageX: number, pageY: number) => {
      if (queueDragRef.current) return; // a drag is already active → idempotent
      const r = cardRectRef.current;
      const grabX = r.w ? pageX - r.x : 60;
      const grabY = r.h ? pageY - r.y : 24;
      beginQueueDrag(entry.id, idxRef.current, r.w || 280, r.h || 64, grabX, grabY, pageX, pageY);
    }, [entry.id]);
    const startCardDragRef = useRef(startCardDrag);
    startCardDragRef.current = startCardDrag;

    // NATIVE: claim the responder only on a real MOVE so taps reach the inner
    // buttons. Once granted, the whole card drives the drag. All handlers go
    // through refs so the once-created responder always runs the latest logic.
    const cardPan = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 || Math.abs(g.dx) > 6,
        onPanResponderGrant: (e) => {
          startCardDragRef.current(e.nativeEvent.pageX, e.nativeEvent.pageY);
        },
        onPanResponderMove: (e) => {
          if (Platform.OS === 'web') return;
          const { pageX, pageY } = e.nativeEvent;
          setQueueDrag((prev) => (prev ? { ...prev, x: pageX, y: pageY } : prev));
          const drag = queueDragRef.current;
          const insert = queueInsertIndexAt(pageY);
          setQueueInsertIdx(insert);
          if (drag) computeQueueShiftsRef.current(drag.fromIdx, insert);
        },
        onPanResponderRelease: (e) => {
          if (Platform.OS === 'web') return; // handled by window pointerup
          const { pageX, pageY } = e.nativeEvent;
          const drag = queueDragRef.current;
          queueDragRef.current = null;
          setQueueDrag(null);
          setQueueInsertIdx(null);
          if (drag) resolveQueueDropRef.current(drag.fromIdx, pageX, pageY);
        },
        onPanResponderTerminate: () => {
          if (Platform.OS === 'web') return;
          queueDragRef.current = null;
          setQueueDrag(null);
          setQueueInsertIdx(null);
          settleQueueShifts();
        },
      }),
    ).current;

    // WEB: threshold-gated pointerdown bootstrap WITHOUT claiming a responder, so
    // a plain click still reaches the inner buttons. Only once the pointer moves
    // past the threshold does it lift the card and hand off to beginQueueDrag's
    // window listeners. A click on an inner button stops propagation so it never
    // even arms this bootstrap.
    const onCardPointerDownWeb = useCallback((ev: any) => {
      if (Platform.OS !== 'web') return;
      if (ev.button != null && ev.button !== 0) return; // left/primary only
      const startX = ev.pageX; const startY = ev.pageY;
      let started = false;
      const w = window as any;
      const onMove = (e: PointerEvent) => {
        if (!started) {
          if (Math.abs(e.pageX - startX) <= 6 && Math.abs(e.pageY - startY) <= 6) return;
          started = true;
          startCardDrag(startX, startY);
        }
        if (started) {
          w.removeEventListener('pointermove', onMove, true);
          w.removeEventListener('pointerup', onUp, true);
        }
      };
      const onUp = () => {
        w.removeEventListener('pointermove', onMove, true);
        w.removeEventListener('pointerup', onUp, true);
      };
      w.addEventListener('pointermove', onMove, true);
      w.addEventListener('pointerup', onUp, true);
    }, [startCardDrag]);

    // Drag-trigger props spread onto the card body. On web the inner buttons stop
    // propagation of their own pointerdown so they never start a drag.
    const dragTriggerProps = {
      ...cardPan.panHandlers,
      ...(Platform.OS === 'web' ? { onPointerDown: onCardPointerDownWeb } : {}),
    };

    // Spread onto every inner interactive control (▲▼/수정/삭제/배정/슬롯) so a
    // press there never arms the card-drag bootstrap (web stops pointerdown
    // propagation). The control keeps its own onPress. Native is already safe
    // because the card PanResponder claims on MOVE, not start.
    const stopDragProps = Platform.OS === 'web'
      ? { onPointerDown: (e: any) => e.stopPropagation?.() }
      : {};

    // Subtle ≡ affordance for discoverability (NOT the trigger — the whole card
    // is draggable now). Purely decorative; pointer events pass through to the
    // card body's drag handlers.
    const QueueDragHandle = (
      <View
        pointerEvents="none"
        style={[styles.dragHandle, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
        accessibilityLabel="드래그하여 순서 변경"
      >
        <Icon name="menu" size={14} color={colors.textLight} />
      </View>
    );

    // A queued game is court-assignable with 2–4 players (단식 2 / 복식 3–4 /
    // 부분 편성). Only a 1-player draft can't be assigned. `isFull` (=4) is kept
    // for the "(n/4)" affordance hints only.
    const isFull = entry.playerIds.length === 4;
    const isAssignable = entry.playerIds.length >= 2;
    const canAssign = emptyCourts.length > 0 && isAssignable;
    const isNext = idx === 0;

    // ── COLLAPSED: a scannable card-ish row. Two stacked lines:
    //   line 1 — order # + (muted) game-type label + 수정
    //   line 2 — the 4 player chips with breathing room between them
    // Each game is a clearly separated card (surface bg + border + gap), so
    // ~5-7 games stay visible at 768 while being far more readable than the
    // old single cramped line. No game-type color rail/tint — calm + uniform.
    if (!editing) {
      return (
        <RNAnimated.View
          // Open the card-sized gap: this card slides to make room (or back).
          style={{ transform: [{ translateY: shiftAnim }] }}
        >
          <View
            ref={cardRef}
            onLayout={measureCard}
            collapsable={false}
            {...dragTriggerProps}
            style={[
              styles.queueRow2,
              {
                backgroundColor: colors.surface,
                borderColor: isNext ? colors.primary : colors.border,
                borderWidth: isNext ? 1.5 : 1,
              },
              // The lifted card is shown as a floating copy under the finger, so
              // hide the in-list original entirely → leaves a clean card-sized gap.
              isCardDragSource && { opacity: 0 },
            ]}
          >
            <View style={styles.queueRow2Top}>
              {QueueDragHandle}
              <View style={[styles.queueNumSm, { backgroundColor: isNext ? colors.primary : colors.primaryLight }]}>
                <Text style={[styles.queueNumText, { color: isNext ? palette.white : colors.primary }]}>{idx + 1}</Text>
              </View>
              {isNext && (
                <View style={[styles.nextTag, { backgroundColor: colors.primaryBg }]}>
                  <Text style={[styles.nextTagText, { color: colors.primary }]}>다음</Text>
                </View>
              )}
              <GameTypeLabel playerIds={entry.playerIds} />
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[styles.editBtnSm, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setEditingEntryId(entry.id)}
                accessibilityLabel="수정"
                activeOpacity={0.8}
                hitSlop={6}
                {...stopDragProps}
              >
                <Icon name="edit" size={12} color={colors.textSecondary} />
                <Text style={[styles.editBtnText, { color: colors.textSecondary }]}>수정</Text>
              </TouchableOpacity>
            </View>
            {/* 4 player chips on their own line, evenly spaced so names don't blur. */}
            <View style={styles.miniChipRow}>
              {[0, 1, 2, 3].map((slotIdx) => (
                <QueueMiniChip
                  key={slotIdx}
                  pId={entry.playerIds[slotIdx]}
                  name={entry.playerNames?.[slotIdx]}
                />
              ))}
            </View>
          </View>
        </RNAnimated.View>
      );
    }

    // ── EXPANDED (editing): full editable 2×2 view + controls. ──
    // The body is NOT a drag trigger here (too many controls; reorder while
    // editing uses ▲▼). It still gets the gap-shift wrapper so it makes room
    // when another card is dragged past it, and stays a registered drop target.
    return (
      <RNAnimated.View style={{ transform: [{ translateY: shiftAnim }] }}>
        <View
          ref={cardRef}
          onLayout={measureCard}
          collapsable={false}
          style={[
            styles.queueItem,
            { backgroundColor: colors.primaryBg, borderColor: colors.primary },
            { borderWidth: 2 },
          ]}
        >
        {/* ─── Header: drag handle + order # + (muted) type label + 완료 ─── */}
        <View style={styles.queueCardHeader}>
          {QueueDragHandle}
          <View style={[styles.queueNum, { backgroundColor: idx === 0 ? colors.primary : colors.primaryLight }]}>
            <Text style={[styles.queueNumText, { color: idx === 0 ? palette.white : colors.primary }]}>{idx + 1}</Text>
          </View>
          <GameTypeLabel playerIds={entry.playerIds} />
          <View style={{ flex: 1 }} />

          {/* 수정 toggle. Switches THIS card back to compact. */}
          <TouchableOpacity
            style={[styles.editBtn, { borderColor: colors.primary, backgroundColor: colors.primary }]}
            onPress={() => setEditingEntryId(null)}
            accessibilityLabel="완료"
            activeOpacity={0.8}
            hitSlop={6}
          >
            <Icon name="edit" size={13} color={palette.white} />
            <Text style={[styles.editBtnText, { color: palette.white }]}>완료</Text>
          </TouchableOpacity>
        </View>

        {/* 4 players in a readable 2×2 grid (full names, gender, 급수, 게임수). */}
        <View style={styles.gameGrid}>
          {[0, 1, 2, 3].map((slotIdx) => (
            <QueueSlot key={slotIdx} entry={entry} slotIdx={slotIdx} editing={editing} />
          ))}
        </View>

        {/* ─── EDIT-only controls ─── */}
        {editing && (
          <>
            <View style={styles.queueActions}>
              <TouchableOpacity
                style={[styles.reorderBtnRow, { borderColor: colors.border, opacity: idx === 0 ? 0.35 : 1 }]}
                onPress={() => moveQueueItem(idx, idx - 1)}
                disabled={idx === 0}
                accessibilityLabel="위로 이동"
                hitSlop={6}
              >
                <Icon name="chevronUp" size={15} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reorderBtnRow, { borderColor: colors.border, opacity: idx === queuedEntries.length - 1 ? 0.35 : 1 }]}
                onPress={() => moveQueueItem(idx, idx + 1)}
                disabled={idx === queuedEntries.length - 1}
                accessibilityLabel="아래로 이동"
                hitSlop={6}
              >
                <Icon name="chevronDown" size={15} color={colors.textSecondary} />
              </TouchableOpacity>
              {/* Court assignment accepts 2–4 players (단식/복식/부분 편성). Only a
                  1-player draft is blocked with a friendly hint; the server also
                  guards this ("2명 이상이어야 배정할 수 있어요"). */}
              <TouchableOpacity
                style={[styles.queueActionBtn, {
                  backgroundColor: canAssign ? colors.primaryBg : colors.surfaceSecondary,
                  borderColor: canAssign ? colors.primary : colors.border,
                }]}
                onPress={() => {
                  if (!isAssignable) { showAlert('알림', '2명 이상이어야 배정할 수 있어요'); return; }
                  setAssignTarget(isAssigning ? null : entry.id);
                }}
                disabled={emptyCourts.length === 0}
                activeOpacity={0.8}
              >
                <Icon name="play" size={14} color={canAssign ? colors.primary : colors.textLight} />
                <Text style={[styles.queueActionText, { color: canAssign ? colors.primary : colors.textLight }]}>
                  {emptyCourts.length === 0 ? '빈 코트 없음' : !isAssignable ? '2명 이상 필요' : '코트 배정'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.queueActionBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}
                onPress={() => handleDeleteQueued(entry.id)}
                activeOpacity={0.8}
              >
                <Icon name="delete" size={14} color={colors.danger} />
                <Text style={[styles.queueActionText, { color: colors.danger }]}>삭제</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.editHint, { color: colors.textLight }]}>
              슬롯 탭=교체 · 미편성에서 끌어와 놓기=교체 · ▲▼=순서
            </Text>

            {/* inline court picker (배정) */}
            {isAssigning && (
              <View style={[styles.assignPicker, { borderTopColor: colors.divider }]}>
                <Text style={[styles.assignHint, { color: colors.textSecondary }]}>배정할 빈 코트 선택</Text>
                <View style={styles.assignCourtRow}>
                  {emptyCourts.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.assignCourtChip, { backgroundColor: colors.primary }]}
                      onPress={() => handleAssign(entry.id, c.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.assignCourtChipText}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
        </View>
      </RNAnimated.View>
    );
  };

  const QueuePanel = (
    <View style={[styles.queueCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
      <View style={styles.queueHeaderRow}>
        <Text style={[styles.queueHeading, { color: colors.text }]}>다음 게임 ({queuedEntries.length}조)</Text>
        <Text style={[styles.queueHint, { color: colors.textLight }]}>카드를 끌어 순서 변경 · 수정=편집</Text>
      </View>
      {queuedEntries.length === 0 ? (
        <Text style={[styles.queueEmpty, { color: colors.textLight }]}>
          왼쪽에서 2~4명을 골라 "다음 게임 추가"로 큐를 만드세요
        </Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {queuedEntries.map((entry, idx) => <QueueItem key={entry.id} entry={entry} idx={idx} />)}
        </View>
      )}
    </View>
  );

  const CourtCard = ({ court }: { court: Court }) => {
    const isMaint = court.status === 'MAINTENANCE';
    // A court is EMPTY only when the SERVER says so (court.status). Relying on
    // board entries alone misses games created directly (no GameBoardEntry, e.g.
    // seeded games or turns started outside the board) and would let the board
    // offer to assign onto an occupied court. Prefer the board entry for the
    // in-use details; fall back to the court's own currentTurn so an occupied
    // court without a board entry still renders correctly.
    const playingEntry = playingByCourtId.get(court.id);
    const isEmpty = !isMaint && court.status === 'EMPTY' && !playingEntry;
    // Unified player data for the in-use card: board entry first, else the
    // server-provided currentTurn.
    const occupiedPlayerIds = playingEntry?.playerIds ?? court.currentTurn?.playerIds ?? [];
    const occupiedPlayerNames = playingEntry?.playerNames ?? court.currentTurn?.playerNames ?? [];
    // Width comes from the MEASURED court area / column count (not the window),
    // so each court is wide enough that its inner 2×2 cell is ≥ ~150px.
    const courtWidth = courtCardWidth ? { width: courtCardWidth } : null;

    // ── COMPACT empty / maintenance card: ~half the height of an in-use card.
    // A slim single row: court name + a clear "비어있음 · 탭하여 배정" affordance.
    // Tapping an empty court with a queued game ready assigns the next game.
    if (isEmpty || isMaint) {
      // A queued game with 2–4 players is assignable; only a 1-player draft is not.
      const hasAssignable = queuedEntries.some((e) => e.playerIds.length >= 2);
      const canAssign = isEmpty && hasAssignable;
      const affordance = isMaint
        ? '사용 불가'
        : canAssign
          ? '탭하여 다음 게임 배정'
          : queuedEntries.length > 0
            ? '배정 가능한 게임 없음'
            : '대기 게임 없음';
      const dotColor = isMaint ? colors.courtMaintenance : colors.courtEmpty;
      const Wrapper: any = canAssign ? TouchableOpacity : View;
      return (
        <Wrapper
          style={[
            styles.courtCardSlim,
            courtWidth,
            {
              backgroundColor: colors.surface,
              borderColor: canAssign ? colors.primary : colors.border,
              borderStyle: canAssign ? 'solid' : 'dashed',
            },
          ]}
          {...(canAssign
            ? { onPress: () => handleAssignToCourt(court.id), activeOpacity: 0.8, accessibilityLabel: `${court.name} 배정` }
            : {})}
        >
          <View style={[styles.courtStateDot, { backgroundColor: dotColor }]} />
          <Text style={[styles.courtSlimName, { color: isMaint ? colors.textSecondary : colors.text }]} numberOfLines={1}>
            {court.name}
          </Text>
          <Text style={[styles.courtSlimState, { color: isMaint ? colors.textLight : colors.textSecondary }]}>
            {isMaint ? '사용 불가' : '비어있음'}
          </Text>
          <View style={{ flex: 1 }} />
          <Text
            style={[styles.courtSlimHint, { color: canAssign ? colors.primary : colors.textLight }]}
            numberOfLines={1}
          >
            {affordance}
          </Text>
          {canAssign && <Icon name="play" size={14} color={colors.primary} />}
        </Wrapper>
      );
    }

    // ── IN-USE card: readable 2×2 players + 게임 종료.
    // No game-type accent rail or tint — game type is a calm grey label only.
    return (
      <View
        style={[
          styles.courtCard,
          courtWidth,
          { backgroundColor: colors.surface, borderColor: colors.border },
          shadows.sm,
        ]}
      >
        <View style={styles.courtCardHeader}>
          <Text style={[styles.courtCardName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          <GameTypeLabel playerIds={occupiedPlayerIds} />
          <View style={[styles.courtStateBadge, { backgroundColor: colors.warningLight }]}>
            <View style={[styles.courtStateDot, { backgroundColor: colors.courtInGame }]} />
            <Text style={[styles.courtStateText, { color: colors.warning }]}>게임 중</Text>
          </View>
        </View>

        {/* Readable 2×2 grid: 급수 avatar + FULL name + gender + 게임수. */}
        <View style={styles.gameGrid}>
          {[0, 1, 2, 3].map((slotIdx) => {
            const pId = occupiedPlayerIds[slotIdx];
            const name = occupiedPlayerNames?.[slotIdx];
            const busy = pId ? busySet.has(pId) : false;
            return (
              <View key={slotIdx} style={styles.gameGridCell}>
                <GamePlayerChip pId={pId} name={name} busy={busy} />
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.courtActionBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}
          onPress={() => handleEndGame(court.id)}
          activeOpacity={0.8}
        >
          <Icon name="stop" size={14} color={colors.danger} />
          <Text style={[styles.courtActionText, { color: colors.danger }]}>게임 종료</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────
  // Header + side actions
  // ─────────────────────────────────────────────────────────
  // On NARROW screens (phones / small tablets) the 6 action buttons can't fit
  // inline next to the title without squishing it into a 1-char column and
  // overflowing off-screen. There we render TWO rows: a full-width title row,
  // then a horizontally-scrollable button row (web-safe). Wide screens (≥ the
  // tablet breakpoint) keep the original single inline row.
  const narrowHeader = layout.width < 768;

  const headerActions = (
    <>
      <TouchableOpacity
        style={[styles.headerLink, { borderColor: colors.border }]}
        onPress={() => setCourtModal(true)}
        activeOpacity={0.8}
      >
        <Icon name="court" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>코트 관리</Text>
      </TouchableOpacity>
      {!!clubId && (
        <TouchableOpacity
          style={[styles.headerLink, { borderColor: colors.border }]}
          onPress={() => {
            setUnreadChat(0);
            router.push(`/club/${clubId}/chat`);
          }}
          activeOpacity={0.8}
          accessibilityLabel="채팅 건의"
        >
          <Text style={styles.headerChatIcon}>💬</Text>
          <Text style={[styles.headerLinkText, { color: colors.primary }]}>건의</Text>
          {unreadChat > 0 && (
            <View style={[styles.unreadDot, { backgroundColor: colors.danger }]}>
              <Text style={styles.unreadDotText}>{unreadChat > 9 ? '9+' : unreadChat}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.headerLink, { borderColor: colors.border }]}
        onPress={() => router.push(`/session/${clubSessionId}/board`)}
        activeOpacity={0.8}
      >
        <Icon name="tv" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>현황 보드</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerLink, { borderColor: colors.border }]}
        onPress={() => router.push(`/session/${clubSessionId}/qr`)}
        activeOpacity={0.8}
        accessibilityLabel="출석 QR"
      >
        <Icon name="qr" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>출석 QR</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerLink, { borderColor: colors.border }]}
        onPress={copyAttendLink}
        activeOpacity={0.8}
        disabled={copyingLink}
        accessibilityLabel="출석 링크 복사"
      >
        {copyingLink ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="link" size={16} color={colors.primary} />
        )}
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>출석 링크 복사</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerLink, { borderColor: colors.danger, backgroundColor: colors.dangerBg }]}
        onPress={handleEndSession}
        activeOpacity={0.8}
        accessibilityLabel="정모 종료"
      >
        <Icon name="stop" size={16} color={colors.danger} />
        <Text style={[styles.headerLinkText, { color: colors.danger }]}>정모 종료</Text>
      </TouchableOpacity>
    </>
  );

  const backButton = (
    <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={10} style={styles.headerBack}>
      <Icon name="back" size={22} color={colors.text} />
    </TouchableOpacity>
  );

  const titleBlock = (
    <View style={styles.headerTitleBlock}>
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
        {clubName ? `${clubName} 운영판` : '운영판'}
      </Text>
      <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
        미편성 {freePool.length}명 · 코트 {courts.length}개{guestCount > 0 ? ` · 게스트 ${guestCount}명` : ''}
      </Text>
    </View>
  );

  const Header = narrowHeader ? (
    <View style={[styles.headerNarrow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.headerTitleRow}>
        {backButton}
        {titleBlock}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.headerActionsScroll}
        refreshControl={undefined}
      >
        {headerActions}
      </ScrollView>
    </View>
  ) : (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {backButton}
      {titleBlock}
      {headerActions}
    </View>
  );

  const PoolActions = (
    <View style={styles.poolActions}>
      <TouchableOpacity
        style={[styles.poolActionBtn, { backgroundColor: colors.secondaryLight }]}
        onPress={() => setGuestModal(true)}
        activeOpacity={0.8}
      >
        <Icon name="add" size={15} color={colors.secondary} />
        <Text style={[styles.poolActionText, { color: colors.secondary }]}>게스트</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.poolActionBtn, { backgroundColor: colors.warningLight }]}
        onPress={() => setFeeModal(true)}
        activeOpacity={0.8}
      >
        <Icon name="stats" size={15} color={colors.warning} />
        <Text style={[styles.poolActionText, { color: colors.warning }]}>게스트비 정산</Text>
      </TouchableOpacity>
    </View>
  );

  const modals = (
    <>
      {guestModal && <AddGuestModal sessionId={clubSessionId!} colors={colors} onClose={() => setGuestModal(false)} onAdded={() => { setGuestModal(false); loadPool(); }} />}
      {feeModal && <GuestFeeModal sessionId={clubSessionId!} colors={colors} onClose={() => setFeeModal(false)} />}
      {courtModal && facilityId && (
        <CourtManageModal
          facilityId={facilityId}
          sessionId={clubSessionId!}
          colors={colors}
          occupiedCourtIds={new Set([...playingByCourtId.keys()])}
          onClose={() => setCourtModal(false)}
          onChanged={loadCourts}
          onEndSession={handleEndSession}
        />
      )}
      {swapTarget && (
        <SwapPlayerModal
          colors={colors}
          freePool={freePool}
          queuedPool={queuedPool}
          currentIds={queuedEntries.find((e) => e.id === swapTarget.entryId)?.playerIds || []}
          onPick={handleSwapPlayer}
          onClose={() => setSwapTarget(null)}
          allowAddToEmpty={(queuedEntries.find((e) => e.id === swapTarget.entryId)?.playerIds.length ?? 0) < 4}
        />
      )}
      {matchupTarget && clubSessionId && (
        <MatchupModal
          colors={colors}
          clubSessionId={clubSessionId}
          userId={matchupTarget.userId}
          name={matchupTarget.name}
          onCheckout={() => handleOperatorCheckout(matchupTarget.userId, matchupTarget.name)}
          onClose={() => setMatchupTarget(null)}
        />
      )}
    </>
  );

  // Floating drag chip that follows the finger while dragging a pool player.
  const DragOverlay = poolDrag ? (
    <View
      pointerEvents="none"
      style={[
        styles.dragGhost,
        {
          left: poolDrag.x - 60,
          top: poolDrag.y - 20,
          backgroundColor: colors.primary,
        },
      ]}
    >
      <SkillTag level={poolDrag.skill} size="sm" />
      <Text style={styles.dragGhostText} numberOfLines={1}>{poolDrag.name}</Text>
    </View>
  ) : null;

  // Lifted, card-shaped copy that follows the finger/cursor while reordering a
  // queue card. NOT a pill — it's an actual full card (same content + size as the
  // collapsed row) raised with a shadow + slight scale, so it clearly reads as
  // "the card itself is being carried" into its new slot.
  const queueDragEntry = queueDrag
    ? queuedEntries.find((e) => e.id === queueDrag.entryId)
    : undefined;
  const QueueDragOverlay = queueDrag && queueDragEntry ? (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        zIndex: 9999,
        elevation: 14,
        left: queueDrag.x - queueDrag.grabX,
        top: queueDrag.y - queueDrag.grabY,
        width: queueDrag.width,
        transform: [{ scale: 1.03 }],
      }}
    >
      <View
        style={[
          styles.queueRow2,
          styles.queueDragLifted,
          { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1.5 },
        ]}
      >
        <View style={styles.queueRow2Top}>
          <View style={[styles.dragHandle, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
            <Icon name="menu" size={14} color={colors.textLight} />
          </View>
          <View style={[styles.queueNumSm, { backgroundColor: colors.primary }]}>
            <Text style={[styles.queueNumText, { color: palette.white }]}>{queueDrag.fromIdx + 1}</Text>
          </View>
          <GameTypeLabel playerIds={queueDragEntry.playerIds} />
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.miniChipRow}>
          {[0, 1, 2, 3].map((slotIdx) => (
            <QueueMiniChip
              key={slotIdx}
              pId={queueDragEntry.playerIds[slotIdx]}
              name={queueDragEntry.playerNames?.[slotIdx]}
            />
          ))}
        </View>
      </View>
    </View>
  ) : null;

  // ─────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────
  if (twoPane) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.split}>
          {/* LEFT PANE — pool boxes + tray */}
          <View style={[styles.leftPane, { borderRightColor: colors.border }]}>
            <View style={styles.colHeaderRow}>
              <Text style={[styles.colHeader, { color: colors.textSecondary }]}>출석 인원</Text>
              {(genderCount.male > 0 || genderCount.female > 0) && (
                <Text style={[styles.genderCount, { color: colors.textLight }]}>
                  <Text style={{ color: colors.genderMale }}>남 {genderCount.male}</Text>
                  {'  ·  '}
                  <Text style={{ color: colors.genderFemale }}>여 {genderCount.female}</Text>
                </Text>
              )}
            </View>
            {PoolActions}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.poolList}
              showsVerticalScrollIndicator={false}
              refreshControl={undefined}
            >
              {PoolBoxes}
              <View style={{ height: spacing.sm }} />
            </ScrollView>
            <Tray />
          </View>

          {/* RIGHT PANE — courts grid (TOP) + queue (BELOW) */}
          <View style={styles.rightPane}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.rightContent}
              showsVerticalScrollIndicator={false}
              refreshControl={undefined}
            >
              <Text style={[styles.colHeader, { color: colors.textSecondary }]}>코트</Text>
              <View style={styles.courtGrid} onLayout={onCourtAreaLayout}>
                {courts.map((court) => <CourtCard key={court.id} court={court} />)}
                {courts.length === 0 && (
                  <Text style={[styles.emptyPool, { color: colors.textLight }]}>코트가 없어요. "코트 관리"에서 추가하세요</Text>
                )}
              </View>
              {QueuePanel}
            </ScrollView>
          </View>
        </View>
        {DragOverlay}
        {QueueDragOverlay}
        {modals}
      </SafeAreaView>
    );
  }

  // ─── SINGLE-COLUMN STACKED (tablets in portrait, narrow laptops, phones) ───
  // Full-width sections scrolling vertically:
  //   코트 (top) → 다음 게임 큐 (compact rows) → 편성 트레이 + 출석 풀.
  // Every section spans the full content width so each cell is wide enough that
  // 2–4 char Korean names never clip.
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.stackedContent}
        showsVerticalScrollIndicator={false}
        refreshControl={undefined}
      >
        {/* COURTS — full width, measured so the grid picks the right column count */}
        <Text style={[styles.colHeader, { color: colors.textSecondary }]}>코트</Text>
        <View style={styles.courtGrid} onLayout={onCourtAreaLayout}>
          {courts.map((court) => <CourtCard key={court.id} court={court} />)}
          {courts.length === 0 && (
            <Text style={[styles.emptyPool, { color: colors.textLight }]}>코트가 없어요. "코트 관리"에서 추가하세요</Text>
          )}
        </View>

        {/* QUEUE — full width compact rows so 7–8+ games show at once */}
        {QueuePanel}

        {/* COMPOSE TRAY + ATTENDANCE POOL — full width */}
        <View style={styles.colHeaderRow}>
          <Text style={[styles.colHeader, { color: colors.textSecondary }]}>출석 인원</Text>
          {(genderCount.male > 0 || genderCount.female > 0) && (
            <Text style={[styles.genderCount, { color: colors.textLight }]}>
              <Text style={{ color: colors.genderMale }}>남 {genderCount.male}</Text>
              {'  ·  '}
              <Text style={{ color: colors.genderFemale }}>여 {genderCount.female}</Text>
            </Text>
          )}
        </View>
        {PoolActions}
        <Tray />
        {PoolBoxes}
        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
      {DragOverlay}
      {QueueDragOverlay}
      {modals}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────
// Swap-player modal — pick a replacement for a queued-game slot
// ─────────────────────────────────────────────────────────
function SwapPlayerModal({
  colors, freePool, queuedPool, currentIds, onPick, onClose, allowAddToEmpty,
}: {
  colors: any;
  freePool: Player[];
  queuedPool: Player[];
  currentIds: string[];
  onPick: (id: string) => void;
  onClose: () => void;
  /** true when the tapped slot is EMPTY (game has <4 players) → adding, not replacing. */
  allowAddToEmpty?: boolean;
}) {
  const inGame = new Set(currentIds);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, modalStyles.feeSheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <Text style={[modalStyles.sheetTitle, { color: colors.text }]}>{allowAddToEmpty ? '추가할 사람 선택' : '교체할 사람 선택'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} refreshControl={undefined}>
            <Text style={[modalStyles.swapGroupLabel, { color: colors.textSecondary }]}>미편성 (대기) 중에서</Text>
            <View style={modalStyles.swapGrid}>
              {freePool.filter((p) => !inGame.has(p.userId)).map((p) => (
                <View key={p.userId} style={modalStyles.swapCell}>
                  <PlayerCard player={p} onPress={() => onPick(p.userId)} />
                </View>
              ))}
              {freePool.filter((p) => !inGame.has(p.userId)).length === 0 && (
                <Text style={[modalStyles.feeEmpty, { color: colors.textLight }]}>대기 중인 인원이 없어요</Text>
              )}
            </View>
            {queuedPool.length > 0 && (
              <>
                <Text style={[modalStyles.swapGroupLabel, { color: colors.textSecondary }]}>이미 편성됨 (다른 게임과 교체)</Text>
                <View style={modalStyles.swapGrid}>
                  {queuedPool.filter((p) => !inGame.has(p.userId)).map((p) => (
                    <View key={p.userId} style={modalStyles.swapCell}>
                      <PlayerCard
                        player={p}
                        onPress={() => onPick(p.userId)}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// Matchup modal — "오늘 함께 친 사람"
// Fetches the player's matchups (who they played WITH this 정모, sorted by
// count desc) on open. Read-only, calm. Shows "기록 없음" when no partners yet.
// ─────────────────────────────────────────────────────────
function MatchupModal({
  colors, clubSessionId, userId, name, onCheckout, onClose,
}: {
  colors: any;
  clubSessionId: string;
  userId: string;
  name: string;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<PlayerMatchups | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    clubSessionApi.getMatchups(clubSessionId, userId)
      .then(({ data }) => { if (alive) setData(data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clubSessionId, userId]);

  const partners = data?.partners ?? [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, modalStyles.matchupSheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[modalStyles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                {name} · 오늘 함께 친 사람
              </Text>
              {data != null && (
                <Text style={[modalStyles.matchupSub, { color: colors.textSecondary }]}>
                  오늘 {data.totalGames}게임
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: spacing.xxl }} color={colors.primary} />
          ) : partners.length === 0 ? (
            <Text style={[modalStyles.feeEmpty, { color: colors.textLight }]}>
              아직 함께 친 기록이 없어요
            </Text>
          ) : (
            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}
              refreshControl={undefined}
            >
              {partners.map((p) => {
                const skill = getSkillMeta(p.skillLevel);
                const g = getGenderMeta(p.gender);
                return (
                  <View key={p.userId} style={[modalStyles.matchupRow, { borderBottomColor: colors.divider }]}>
                    <View style={[modalStyles.matchupSkill, { borderColor: skill.color, backgroundColor: colors.surface }]}>
                      <Text style={[modalStyles.matchupSkillText, { color: skill.color }]}>
                        {(p.skillLevel || '·').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[modalStyles.matchupName, { color: colors.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {g && <Text style={[modalStyles.matchupGender, { color: g.color }]}>{g.symbol}</Text>}
                    <View style={{ flex: 1 }} />
                    <View style={[modalStyles.matchupCount, { backgroundColor: colors.primaryBg }]}>
                      <Text style={[modalStyles.matchupCountText, { color: colors.primary }]}>{p.count}번</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* 운영자 액션: 이 참가자를 정모에서 체크아웃 (danger). 매치업 탭은
              건드리지 않고 여기 detail 모달에만 둠. 확인 단계를 거침. */}
          <TouchableOpacity
            style={[modalStyles.checkoutBtn, { borderColor: colors.danger }]}
            onPress={onCheckout}
            activeOpacity={0.85}
            accessibilityLabel={`${name} 체크아웃 시키기`}
          >
            <Icon name="close" size={16} color={colors.danger} />
            <Text style={[modalStyles.checkoutBtnText, { color: colors.danger }]}>
              체크아웃 시키기
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// Court-management modal — list / add / rename / availability
// ─────────────────────────────────────────────────────────
function CourtManageModal({
  facilityId, sessionId, colors, occupiedCourtIds, onClose, onChanged, onEndSession,
}: {
  facilityId: string;
  sessionId: string;
  colors: any;
  occupiedCourtIds: Set<string>;
  onClose: () => void;
  onChanged: () => Promise<any> | void;
  onEndSession: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // THIS 정모's OWN courts only (코트1·2·3). No other 모임's courts, no locking.
  const [facilityCourts, setFacilityCourts] = useState<SessionCourt[]>([]);

  const reload = useCallback(async () => {
    try {
      const { data } = await clubSessionApi.getFacilityCourts(sessionId);
      setFacilityCourts(data || []);
    } catch { /* keep prior */ }
    await onChanged();
  }, [sessionId, onChanged]);

  useEffect(() => { reload(); }, [reload]);

  // 코트 추가 (이 정모 전용): 서버가 이 정모의 다음 "코트 N"을 만들어 붙인다.
  // 다른 모임과 충돌 없음 — 항상 성공.
  const addCourt = useCallback(async () => {
    setAdding(true);
    try {
      const { data } = await clubSessionApi.addCourt(sessionId);
      await reload();
      showSuccess(`${data?.court?.name || '코트'} 추가 완료!`);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '코트 추가 실패');
    } finally {
      setAdding(false);
    }
  }, [sessionId, reload]);

  const saveRename = useCallback(async (courtId: string) => {
    const name = renameDraft.trim();
    if (!name) { setRenamingId(null); return; }
    setBusyId(courtId);
    try {
      await courtApi.rename(courtId, name);
      setRenamingId(null);
      await reload();
      showSuccess('이름 변경 완료!');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '이름 변경 실패');
    } finally {
      setBusyId(null);
    }
  }, [renameDraft, reload]);

  const toggleAvailability = useCallback(async (court: SessionCourt) => {
    const makeUnavailable = court.status !== 'MAINTENANCE';
    if (makeUnavailable && occupiedCourtIds.has(court.id)) {
      showAlert('알림', '게임이 진행 중인 코트는 사용 불가로 바꿀 수 없어요. 먼저 게임을 종료하세요.');
      return;
    }
    setBusyId(court.id);
    try {
      if (makeUnavailable) await courtApi.setUnavailable(court.id);
      else await courtApi.setAvailable(court.id);
      await reload();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '상태 변경 실패');
    } finally {
      setBusyId(null);
    }
  }, [occupiedCourtIds, reload]);

  // Delete a court. The server returns a 400 with a friendly {error} message
  // when the court is IN_USE or has usage history ("사용 기록이 있는 코트는
  // 삭제할 수 없어요. 대신 '사용 불가'로 두세요.") — surface it, never crash.
  const removeCourt = useCallback((court: SessionCourt) => {
    if (occupiedCourtIds.has(court.id)) {
      showAlert('알림', '게임이 진행 중인 코트는 삭제할 수 없어요. 먼저 게임을 종료하세요.');
      return;
    }
    showConfirm(
      '코트 삭제',
      `'${court.name}'을(를) 삭제할까요?`,
      async () => {
        setBusyId(court.id);
        try {
          await courtApi.remove(court.id);
          await reload();
          showSuccess('코트 삭제 완료!');
        } catch (err: any) {
          showAlert('알림', err.response?.data?.error || '코트를 삭제할 수 없어요');
        } finally {
          setBusyId(null);
        }
      },
      '삭제', '취소', 'danger',
    );
  }, [occupiedCourtIds, reload]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={modalStyles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[modalStyles.sheet, modalStyles.feeSheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <Text style={[modalStyles.sheetTitle, { color: colors.text }]}>코트 관리</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Add court — auto-named (코트 N), added straight to THIS 정모. */}
          <TouchableOpacity
            style={[modalStyles.addCourtBtn, { backgroundColor: colors.primary, opacity: adding ? 0.6 : 1 }]}
            onPress={addCourt}
            disabled={adding}
            activeOpacity={0.85}
          >
            {adding ? <ActivityIndicator size="small" color={palette.white} /> : (
              <>
                <Icon name="add" size={16} color={palette.white} />
                <Text style={modalStyles.addCourtBtnText}>코트 추가</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[modalStyles.courtSectionHint, { color: colors.textLight }]}>
            이 정모 전용 코트예요. "코트 추가"로 코트를 더 만들거나, 이름 변경·사용 불가·삭제할 수 있어요. 다른 모임 코트와는 완전히 별개예요.
          </Text>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false} refreshControl={undefined}>
            {facilityCourts.length === 0 ? (
              <Text style={[modalStyles.feeEmpty, { color: colors.textLight }]}>아직 코트가 없어요</Text>
            ) : (
              facilityCourts.map((court) => {
                const isMaint = court.status === 'MAINTENANCE';
                const isOccupied = occupiedCourtIds.has(court.id);
                const isRenaming = renamingId === court.id;
                const dotColor = isMaint
                  ? colors.courtMaintenance
                  : isOccupied ? colors.courtInGame
                  : colors.courtEmpty;
                const stateText = isMaint ? '사용 불가' : isOccupied ? '게임 중' : '비어있음';
                const stateColor = isMaint
                  ? colors.textSecondary
                  : isOccupied ? colors.warning
                  : colors.secondary;
                return (
                  <View key={court.id} style={[modalStyles.courtRow, { borderBottomColor: colors.divider }]}>
                    {isRenaming ? (
                      <TextInput
                        style={[modalStyles.input, { flex: 1, color: colors.text, borderColor: colors.primary, backgroundColor: colors.background }]}
                        value={renameDraft}
                        onChangeText={setRenameDraft}
                        autoFocus
                        onSubmitEditing={() => saveRename(court.id)}
                        onBlur={() => saveRename(court.id)}
                      />
                    ) : (
                      <View style={modalStyles.courtRowName}>
                        <View style={[modalStyles.courtStatusDot, { backgroundColor: dotColor }]} />
                        <Text style={[modalStyles.courtNameText, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
                        <Text style={[modalStyles.courtStatusText, { color: stateColor }]}>{stateText}</Text>
                      </View>
                    )}

                    {!isRenaming && (
                      <>
                        <TouchableOpacity
                          style={[modalStyles.courtIconBtn, { borderColor: colors.border }]}
                          onPress={() => { setRenamingId(court.id); setRenameDraft(court.name); }}
                          disabled={busyId === court.id}
                          accessibilityLabel="이름 변경"
                          hitSlop={6}
                        >
                          <Icon name="edit" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            modalStyles.courtToggleBtn,
                            isMaint
                              ? { backgroundColor: colors.secondaryLight }
                              : { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
                          ]}
                          onPress={() => toggleAvailability(court)}
                          disabled={busyId === court.id}
                          activeOpacity={0.8}
                        >
                          {busyId === court.id ? (
                            <ActivityIndicator size="small" color={colors.textSecondary} />
                          ) : (
                            <Text style={[modalStyles.courtToggleText, { color: isMaint ? colors.secondary : colors.textSecondary }]}>
                              {isMaint ? '활성화' : '사용 불가'}
                            </Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[modalStyles.courtIconBtn, { borderColor: colors.dangerLight }]}
                          onPress={() => removeCourt(court)}
                          disabled={busyId === court.id}
                          accessibilityLabel="코트 삭제"
                          hitSlop={6}
                        >
                          <Icon name="delete" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* ─── Destructive: 정모 종료 (end the whole session) ─── */}
          <View style={[modalStyles.dangerZone, { borderTopColor: colors.divider }]}>
            <Text style={[modalStyles.dangerZoneLabel, { color: colors.textSecondary }]}>정모 운영</Text>
            <TouchableOpacity
              style={[modalStyles.endSessionBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}
              onPress={onEndSession}
              activeOpacity={0.85}
            >
              <Icon name="stop" size={16} color={colors.danger} />
              <Text style={[modalStyles.endSessionText, { color: colors.danger }]}>정모 종료</Text>
            </TouchableOpacity>
            <Text style={[modalStyles.dangerZoneHint, { color: colors.textLight }]}>
              종료하면 모든 대기/게임이 정리돼요.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// Add-guest modal
// ─────────────────────────────────────────────────────────
function AddGuestModal({
  sessionId, colors, onClose, onAdded,
}: { sessionId: string; colors: any; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [skill, setSkill] = useState<string>('D');
  const [fee, setFee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (!name.trim()) { showAlert('알림', '게스트 이름을 입력해주세요'); return; }
    setSubmitting(true);
    try {
      const feeAmount = fee.trim() ? Number(fee.replace(/[^0-9]/g, '')) : undefined;
      await clubSessionApi.addGuest(sessionId, {
        name: name.trim(),
        skillLevel: skill,
        ...(feeAmount && feeAmount > 0 ? { feeAmount } : {}),
      });
      showSuccess('게스트 추가 완료!');
      onAdded();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || err.response?.data?.message || '게스트 추가 실패');
    } finally {
      setSubmitting(false);
    }
  }, [name, skill, fee, sessionId, onAdded]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[modalStyles.sheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <Text style={[modalStyles.sheetTitle, { color: colors.text }]}>게스트 추가</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[modalStyles.label, { color: colors.textSecondary }]}>이름</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={name}
            onChangeText={setName}
            placeholder="게스트 이름"
            placeholderTextColor={colors.textLight}
            autoFocus
          />

          <Text style={[modalStyles.label, { color: colors.textSecondary }]}>급수</Text>
          <View style={modalStyles.skillRow}>
            {SKILL_LEVELS.map((lv) => {
              const meta = getSkillMeta(lv);
              const active = skill === lv;
              return (
                <TouchableOpacity
                  key={lv}
                  style={[
                    modalStyles.skillChip,
                    { borderColor: active ? meta.color : colors.border, backgroundColor: active ? meta.color : colors.background },
                  ]}
                  onPress={() => setSkill(lv)}
                  activeOpacity={0.8}
                >
                  <Text style={[modalStyles.skillChipText, { color: active ? palette.white : colors.textSecondary }]}>{lv}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[modalStyles.label, { color: colors.textSecondary }]}>게스트비 (선택)</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={fee}
            onChangeText={setFee}
            placeholder="예: 5000"
            placeholderTextColor={colors.textLight}
            keyboardType="number-pad"
          />

          <TouchableOpacity
            style={[modalStyles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={palette.white} />
            ) : (
              <Text style={modalStyles.submitBtnText}>추가하고 풀에 투입</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// Guest-fee settlement modal
// ─────────────────────────────────────────────────────────
function GuestFeeModal({
  sessionId, colors, onClose,
}: { sessionId: string; colors: any; onClose: () => void }) {
  const [data, setData] = useState<GuestFeeSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await clubSessionApi.getGuestFees(sessionId);
      setData(data);
      const d: Record<string, string> = {};
      for (const item of data.items) d[item.checkInId] = item.feeAmount != null ? String(item.feeAmount) : '';
      setDrafts(d);
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || err.response?.data?.message || '정산 정보를 불러오지 못했어요');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const saveFee = useCallback(async (checkInId: string) => {
    const raw = drafts[checkInId];
    const feeAmount = raw && raw.trim() ? Number(raw.replace(/[^0-9]/g, '')) : null;
    try {
      await clubSessionApi.updateGuestFee(checkInId, { feeAmount });
      await load();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '저장 실패');
    }
  }, [drafts, load]);

  const togglePaid = useCallback(async (checkInId: string, paid: boolean) => {
    try {
      await clubSessionApi.updateGuestFee(checkInId, { feePaid: paid });
      await load();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '저장 실패');
    }
  }, [load]);

  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, modalStyles.feeSheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <Text style={[modalStyles.sheetTitle, { color: colors.text }]}>게스트비 정산</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: spacing.xxl }} color={colors.primary} />
          ) : !data || data.items.length === 0 ? (
            <Text style={[modalStyles.feeEmpty, { color: colors.textLight }]}>아직 게스트가 없어요</Text>
          ) : (
            <>
              {/* Totals */}
              <View style={[modalStyles.totals, { backgroundColor: colors.background }]}>
                <View style={modalStyles.totalItem}>
                  <Text style={[modalStyles.totalLabel, { color: colors.textSecondary }]}>게스트</Text>
                  <Text style={[modalStyles.totalValue, { color: colors.text }]}>{data.totals.guestCount}명</Text>
                </View>
                <View style={modalStyles.totalItem}>
                  <Text style={[modalStyles.totalLabel, { color: colors.textSecondary }]}>총액</Text>
                  <Text style={[modalStyles.totalValue, { color: colors.text }]}>{won(data.totals.totalFee)}</Text>
                </View>
                <View style={modalStyles.totalItem}>
                  <Text style={[modalStyles.totalLabel, { color: colors.textSecondary }]}>납부</Text>
                  <Text style={[modalStyles.totalValue, { color: colors.secondary }]}>{won(data.totals.paidFee)}</Text>
                </View>
                <View style={modalStyles.totalItem}>
                  <Text style={[modalStyles.totalLabel, { color: colors.textSecondary }]}>미납</Text>
                  <Text style={[modalStyles.totalValue, { color: colors.danger }]}>{won(data.totals.unpaidFee)}</Text>
                </View>
              </View>

              <ScrollView style={modalStyles.feeList} showsVerticalScrollIndicator={false} refreshControl={undefined}>
                {data.items.map((item) => (
                  <View key={item.checkInId} style={[modalStyles.feeRow, { borderBottomColor: colors.divider }]}>
                    <Text style={[modalStyles.feeName, { color: colors.text }]} numberOfLines={1}>{item.guestName}</Text>
                    <TextInput
                      style={[modalStyles.feeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={drafts[item.checkInId] ?? ''}
                      onChangeText={(v) => setDrafts((p) => ({ ...p, [item.checkInId]: v }))}
                      onBlur={() => saveFee(item.checkInId)}
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                      keyboardType="number-pad"
                    />
                    <TouchableOpacity
                      style={[
                        modalStyles.paidToggle,
                        item.feePaid
                          ? { backgroundColor: colors.secondary }
                          : { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
                      ]}
                      onPress={() => togglePaid(item.checkInId, !item.feePaid)}
                      activeOpacity={0.8}
                    >
                      <Text style={[modalStyles.paidToggleText, { color: item.feePaid ? palette.white : colors.textSecondary }]}>
                        {item.feePaid ? '납부 완료' : '미납'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, gap: spacing.sm,
  },
  // NARROW (phone / small tablet) header: title row on top, horizontally
  // scrollable action-button row below. Keeps the title readable on one line and
  // every action reachable without horizontal page overflow.
  headerNarrow: {
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
    borderBottomWidth: 1, gap: spacing.sm,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerActionsScroll: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.xs },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  headerBack: { padding: spacing.xs },
  headerTitle: { ...typography.subtitle1 },
  headerSub: { ...typography.caption, marginTop: 1 },
  headerLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1,
    flexShrink: 0,
  },
  headerLinkText: { ...typography.buttonSm },
  headerChatIcon: { fontSize: 14 },
  unreadDot: {
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', marginLeft: 2,
  },
  unreadDotText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  // Split (tablet)
  split: { flex: 1, flexDirection: 'row' },
  leftPane: { width: '38%', minWidth: 340, borderRightWidth: 1, paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, gap: spacing.xs },
  rightPane: { flex: 1, paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, gap: spacing.sm },
  rightContent: { gap: spacing.sm, paddingBottom: spacing.xl },

  colHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colHeader: { ...typography.overline, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },

  poolActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  poolActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.lg,
  },
  poolActionText: { ...typography.buttonSm },

  // Pool boxes
  poolList: { paddingBottom: spacing.sm, gap: spacing.sm },
  poolBox: { borderRadius: radius.card, borderWidth: 1, padding: spacing.sm, marginBottom: spacing.sm },
  poolBoxHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  poolBoxDot: { width: 8, height: 8, borderRadius: 4 },
  poolBoxLabel: { ...typography.subtitle2, flex: 1 },
  poolBoxCount: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  poolBoxCountText: { fontSize: 11, fontWeight: '800' },
  poolBoxEmpty: { ...typography.caption, paddingVertical: spacing.sm, textAlign: 'center' },

  poolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // 2 columns. In the full-width single-column layout each card is ~340px wide,
  // and even in the narrow (>=1200) two-pane left column it's ~220px → the name
  // area stays >= ~150px so 2–4 char Korean names (and short guest names) never
  // clip; only a very long guest name ellipsizes, in that one card.
  poolCell: { width: '48.5%' },
  // Small ⓘ info button overlaid on a pool tile's right edge (vertically
  // centered, away from the top-right conflict dot). A SEPARATE touch target so
  // it opens the matchup popup without triggering the tile's tap-to-stage.
  infoBtn: {
    position: 'absolute', right: 4, top: '50%', marginTop: -11,
    width: 22, height: 22, borderRadius: 11, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  // SOFT composition hints near the 대기등록 button — calm, never blocking.
  compHints: { gap: 4, marginTop: 2 },
  compHintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compHintDot: { width: 7, height: 7, borderRadius: 4 },
  compHintText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  busyBadge: {
    position: 'absolute', top: -4, right: 2, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: radius.sm,
  },
  busyBadgeText: { color: palette.white, fontSize: 9, fontWeight: '900' },
  genderCount: { fontSize: 12, fontWeight: '800' },
  emptyPool: { ...typography.caption, padding: spacing.lg, textAlign: 'center', width: '100%' },

  // Drag-to-compose floating ghost (follows finger)
  dragGhost: {
    position: 'absolute', zIndex: 9999, elevation: 12,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.pill, maxWidth: 140,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  dragGhostText: { color: palette.white, fontSize: 12, fontWeight: '800', flexShrink: 1 },

  // Compact 급수 mark (colored letter on a thin colored border) — replaces the
  // old heavy filled circular avatar so chips/tiles get smaller and denser.
  skillTag: {
    width: 18, height: 18, borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  skillTagText: { fontWeight: '900' },

  // Tray
  trayCard: { borderRadius: radius.card, borderWidth: 1, padding: spacing.smd, gap: spacing.sm },
  trayHeading: { ...typography.subtitle2 },
  trayRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'stretch' },
  traySlot: {
    flex: 1, minHeight: 42, borderRadius: radius.md,
    borderWidth: 1.5, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    paddingHorizontal: 4,
  },
  traySlotInner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2, width: '100%' },
  traySlotText: { flex: 1, minWidth: 0 },
  traySlotName: { fontSize: 11.5, fontWeight: '700' },
  traySlotGames: { fontSize: 9.5, fontWeight: '700', marginTop: 1 },
  traySlotX: { fontSize: 14, fontWeight: '700' },
  traySlotEmpty: { fontSize: 13, fontWeight: '600' },
  suggestNote: { ...typography.caption, fontWeight: '600' },
  trayButtons: { flexDirection: 'row', gap: spacing.sm },
  suggestBtn: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minHeight: 46,
  },
  suggestBtnText: { color: palette.white, ...typography.button },
  // 매칭 모드 선택기 (칩 묶음)
  modeChooser: {
    marginTop: spacing.sm, padding: spacing.sm,
    borderWidth: 1, borderRadius: radius.lg, gap: spacing.xs,
  },
  modeChooserTitle: { ...typography.caption, fontWeight: '700', marginBottom: 2 },
  modeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  modeChip: {
    flexGrow: 1, flexBasis: '31%', minWidth: 96,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderRadius: radius.md,
  },
  modeChipLabel: { ...typography.buttonSm, fontWeight: '700' },
  modeChipHint: { fontSize: 10, marginTop: 1 },
  clearBtn: {
    paddingHorizontal: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  clearBtnText: { ...typography.buttonSm },
  registerBtn: {
    paddingVertical: spacing.md, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minHeight: 46,
  },
  registerBtnText: { color: palette.white, ...typography.button },

  // Queue panel
  queueCard: { borderRadius: radius.card, borderWidth: 1, padding: spacing.smd, gap: spacing.sm },
  queueHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueHeading: { ...typography.subtitle1 },
  queueHint: { fontSize: 11, fontWeight: '600' },
  queueEmpty: { ...typography.caption, paddingVertical: spacing.lg, textAlign: 'center' },

  queueItem: { borderRadius: radius.lg, borderWidth: 1.5, paddingVertical: spacing.sm, paddingRight: spacing.sm, paddingLeft: spacing.md, gap: spacing.xs, overflow: 'hidden' },
  queueCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  // ─── COLLAPSED queue row — a scannable two-line card (≈64–72px). ───
  // Line 1: order # + 다음 tag + (muted) game-type label + 수정.
  // Line 2: 4 player chips with breathing room. Taller than the old single
  // cramped line, but each game is clearly separated → ~5-7 visible at 768.
  queueRow2: {
    borderRadius: radius.lg,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    gap: spacing.sm, overflow: 'hidden',
  },
  queueRow2Top: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // The lifted floating copy of a card while dragging (shadow makes it read as
  // physically picked up off the list, hovering over the card-sized gap).
  queueDragLifted: {
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  queueNumSm: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  nextTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  nextTagText: { fontSize: 11, fontWeight: '800' },
  // The 4 player chips split the FULL row width evenly on their own line.
  miniChipRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  miniChip: {
    flex: 1, flexBasis: 0, minWidth: 0,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.md, borderWidth: 1, overflow: 'hidden',
  },
  // Compact colored 급수 LETTER inside a queue mini-chip (replaces the old dot).
  miniChipSkill: {
    width: 17, height: 17, borderRadius: radius.xs, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  miniChipSkillText: { fontSize: 10, fontWeight: '900', lineHeight: 12 },
  miniChipName: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  // Bigger + bolder gender-colored ♂/♀ so it reads at a glance in compact rows.
  miniChipGender: { fontSize: 15, fontWeight: '900', lineHeight: 17 },
  miniChipEmpty: { fontSize: 13, fontWeight: '700', textAlign: 'center', flex: 1 },
  editBtnSm: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.md, borderWidth: 1,
  },
  dragHandle: {
    width: 24, height: 28, borderRadius: radius.sm, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  queueNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  queueNumText: { fontSize: 12, fontWeight: '800' },

  // ─── Shared 2×2 game-player grid + legible chip (court + queue) ───
  gameGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gameGridCell: { width: '48.5%' },
  gameChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: 4, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, minHeight: 32, overflow: 'hidden',
  },
  gameChipEmpty: { borderStyle: 'dashed', justifyContent: 'center' },
  gameChipEmptyText: { fontSize: 12, fontWeight: '600' },
  gameChipBody: { flex: 1, minWidth: 0 },
  gameChipNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Name = primary content: 13.5px, bold, full (never truncated for KO names).
  gameChipName: { fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  // Gender marker = a BARE colored ♂/♀ glyph (no tinted pill) — bigger + bolder
  // + gender-colored so male/female pop at a glance on every on-court chip.
  gameChipGenderText: { fontSize: 15, fontWeight: '900', lineHeight: 17 },
  // 게임수 = secondary, quiet (smaller + lighter weight so it doesn't compete).
  gameChipGames: { fontSize: 10, fontWeight: '600' },

  // Game-type label (남복/여복/혼복) — small but VISIBLE colored TEXT (type tint),
  // no badge/background/rail.
  typeLabel: { fontSize: 12, fontWeight: '800', marginHorizontal: spacing.xs },

  // Small, subtle conflict (double-booking) cue: a tiny red dot in a chip/tile
  // corner. Informational only — never blocks or disables anything. The white
  // ring (borderColor set per surface) lifts it cleanly off the chip background.
  conflictDot: {
    position: 'absolute', top: 3, right: 3,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: palette.red500, borderWidth: 1,
  },

  // 수정 toggle
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.md, borderWidth: 1,
  },
  editBtnText: { fontSize: 11, fontWeight: '800' },
  editHint: { fontSize: 10.5, fontWeight: '600', paddingHorizontal: spacing.xs },

  queueActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  reorderBtnRow: {
    width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  queueActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
  queueActionText: { ...typography.buttonSm },

  assignPicker: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.xs },
  assignHint: { ...typography.caption, fontWeight: '700' },
  assignCourtRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  assignCourtChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  assignCourtChipText: { color: palette.white, ...typography.buttonSm },

  // Courts
  courtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  courtCard: {
    borderRadius: radius.card, borderWidth: 1, paddingVertical: spacing.smd,
    paddingRight: spacing.smd, paddingLeft: spacing.md, gap: spacing.sm,
    overflow: 'hidden',
  },
  // Compact empty / maintenance court — a slim single row, ~half an in-use card.
  // alignSelf:flex-start keeps it from stretching to a taller in-use sibling in
  // the same flex-wrap row (so it stays genuinely compact in mixed rows).
  courtCardSlim: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: radius.card, borderWidth: 1,
    paddingVertical: spacing.smd, paddingHorizontal: spacing.md,
    minHeight: 48, maxHeight: 56, overflow: 'hidden',
  },
  // The court NAME has priority — never shrinks → never clips ("코…"). If the
  // row is tight, the affordance text (courtSlimHint) truncates instead.
  courtSlimName: { ...typography.subtitle2, flexShrink: 0 },
  courtSlimState: { fontSize: 11, fontWeight: '700', flexShrink: 0 },
  courtSlimHint: { fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  // Single-column stacked layout content padding.
  stackedContent: { padding: spacing.md, gap: spacing.md },
  courtCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  courtCardName: { ...typography.subtitle2, fontSize: 15, flexShrink: 1 },
  courtStateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto',
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill,
  },
  courtStateDot: { width: 7, height: 7, borderRadius: 4 },
  courtStateText: { fontSize: 11, fontWeight: '700' },

  courtActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
  courtActionText: { ...typography.buttonSm },

  // Denied
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  deniedTitle: { ...typography.h3 },
  deniedSub: { ...typography.body2, textAlign: 'center' },
  deniedBtn: { marginTop: spacing.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderRadius: radius.lg },
  deniedBtnText: { color: palette.white, ...typography.button },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  sheet: {
    width: '100%', maxWidth: 460, borderRadius: radius.card, padding: spacing.xl, gap: spacing.sm,
  },
  feeSheet: { maxWidth: 560, maxHeight: '85%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { ...typography.h3 },
  label: { ...typography.caption, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    ...typography.body1,
  },
  skillRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  skillChip: {
    width: 38, height: 38, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  skillChipText: { fontSize: 15, fontWeight: '800' },
  submitBtn: {
    marginTop: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  submitBtnText: { color: palette.white, ...typography.button },

  // Swap modal
  swapGroupLabel: { ...typography.overline, marginTop: spacing.sm, marginBottom: spacing.xs },
  swapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swapCell: { width: '48%' },

  // Matchup modal ("오늘 함께 친 사람")
  matchupSheet: { maxWidth: 440, maxHeight: '80%' },
  matchupSub: { ...typography.caption, marginTop: 2 },
  matchupRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  matchupSkill: {
    width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  matchupSkillText: { fontSize: 12, fontWeight: '900' },
  matchupName: { ...typography.subtitle2, flexShrink: 1 },
  matchupGender: { fontSize: 15, fontWeight: '900', lineHeight: 17 },
  matchupCount: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  matchupCountText: { fontSize: 12, fontWeight: '800' },
  // 운영자 체크아웃 버튼 (danger, outline)
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.md, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1.5,
  },
  checkoutBtnText: { ...typography.button },

  // Court manage modal
  courtAddRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  courtAddBtn: {
    paddingHorizontal: spacing.lg, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minWidth: 64,
  },
  courtAddBtnText: { color: palette.white, ...typography.button },
  addCourtBtn: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, borderRadius: radius.lg, marginBottom: spacing.sm,
  },
  addCourtBtnText: { color: palette.white, ...typography.button },
  courtRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  courtRowName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  courtSectionHint: { fontSize: 11, marginBottom: spacing.sm, lineHeight: 16 },
  courtInSessionBox: {
    width: 20, height: 20, borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  courtStatusDot: { width: 9, height: 9, borderRadius: 5 },
  courtNameText: { ...typography.subtitle2, flexShrink: 1 },
  courtStatusText: { fontSize: 11, fontWeight: '800' },
  courtIconBtn: {
    width: 36, height: 36, borderRadius: radius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  courtToggleBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, minWidth: 76, alignItems: 'center', justifyContent: 'center',
  },
  courtToggleText: { fontSize: 12, fontWeight: '800' },

  // Danger zone — 정모 종료 (end session)
  dangerZone: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.md, gap: spacing.xs },
  dangerZoneLabel: { ...typography.overline },
  endSessionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1,
  },
  endSessionText: { ...typography.button },
  dangerZoneHint: { ...typography.caption, textAlign: 'center' },

  // Fee modal
  feeEmpty: { ...typography.body2, textAlign: 'center', paddingVertical: spacing.xxl },
  totals: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm,
  },
  totalItem: { alignItems: 'center', gap: 2, flex: 1 },
  totalLabel: { fontSize: 11, fontWeight: '600' },
  totalValue: { ...typography.subtitle2 },
  feeList: { maxHeight: 360 },
  feeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  feeName: { flex: 1, ...typography.subtitle2 },
  feeInput: {
    width: 92, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    fontSize: 14, textAlign: 'right',
  },
  paidToggle: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, minWidth: 84, alignItems: 'center',
  },
  paidToggleText: { fontSize: 12, fontWeight: '800' },
});

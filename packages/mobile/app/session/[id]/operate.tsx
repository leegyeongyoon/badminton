import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  SafeAreaView, ActivityIndicator, Animated as RNAnimated, LayoutAnimation,
  Platform, UIManager, Modal, KeyboardAvoidingView, PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameBoard, GameBoardEntry } from '../../../hooks/useGameBoard';
import { gameBoardApi, type SuggestMode } from '../../../services/gameBoard';
import { useTheme } from '../../../hooks/useTheme';
import { useResponsiveLayout, courtColumnsFor, poolColumnsFor } from '../../../hooks/useResponsiveLayout';
import type { LayoutChangeEvent } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useFacilityRoom, useClubRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Icon } from '../../../components/ui/Icon';
import { getSkillMeta, SKILL_LEVELS } from '../../../constants/skill';
import { getGenderMeta, getGameType, GENDER_META, type Gender } from '../../../constants/gender';
import { GenderMarker } from '../../../components/ui/GenderMarker';
import { PlayerCard } from '../../../components/game-board/PlayerCard';
import api from '../../../services/api';
import { clubApi } from '../../../services/club';
import { clubSessionApi, GuestFeeSettlement, PlayerMatchups, SessionCourt } from '../../../services/clubSession';
import { courtApi } from '../../../services/court';
import { showAlert, showConfirm } from '../../../utils/alert';
import { showSuccess, showError } from '../../../utils/feedback';
import { copyToClipboard } from '../../../utils/clipboard';
import { getItem, setItem } from '../../../services/storage';
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
  isInLesson?: boolean;
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
    // ISO start time of the running game (CourtTurn.startedAt). Drives the
    // per-court "N분 진행 중" elapsed timer. null until the turn actually started.
    startedAt?: string | null;
    playerIds: string[];
    playerNames: string[];
  } | null;
}

type RoleState = 'loading' | 'allowed' | 'denied';

// 자동 추천 매칭 모드 — 운영자가 전략을 고르는 칩. label(짧은 이름) + hint(한 줄 설명)
// + note(추천 후 트레이에 보여줄 안내문). 서버 mode enum 과 1:1.
// 순서 = 실력 격차 스펙트럼: 비슷 → 중간 → 큰 격차
//   공정 / 비슷한 급수 / 균형 접전 / 빡센 게임 / 새 조합
const SUGGEST_MODES: {
  mode: SuggestMode;
  emoji: string;
  label: string;
  hint: string;
  note: string;
}[] = [
  { mode: 'fair', emoji: '⚖️', label: '공정', hint: '적게 친 사람 우선 · 새 파트너', note: '공정하게 추천했어요' },
  { mode: 'similar', emoji: '🎯', label: '비슷한 급수', hint: '급수 차이가 가장 작게 · 수준 맞춘 게임', note: '비슷한 급수로 추천했어요' },
  { mode: 'balanced', emoji: '🤝', label: '균형 접전', hint: '2:2 실력이 팽팽하게 · 중간 격차', note: '균형 접전으로 추천했어요' },
  { mode: 'competitive', emoji: '🔥', label: '빡센 게임', hint: '2강 2약 · 실력 격차 큰 도전', note: '빡센 게임으로 추천했어요' },
  { mode: 'fresh', emoji: '✨', label: '새 조합', hint: '안 친 사람들끼리', note: '새 조합으로 추천했어요' },
];

// ─── Drag-to-compose registry ───────────────────────────────
// A tiny absolute-coordinate drop-target registry so a player tile dragged
// out of the 미편성 pool (PanResponder, works on react-native-web) can be
// dropped onto a game slot. Targets register their on-screen rect (measured
// via measureInWindow); on drag release we hit-test the finger's pageX/pageY.
// 'tray'/'queue' = a player-tile drop slot (compose). 'queue-card' = a whole
// queued game card registered as a reorder drop target (drag the card itself to
// reorder the 다음 게임 대기열).
type DropKind = 'tray' | 'queue' | 'queue-card' | 'court' | 'queue-compose' | 'frame' | 'pool';
// 모드2 자석판 이름표/스냅 상수(드롭 핸들러와 렌더 공용 — 모듈 스코프).
const MAG_W = 132, MAG_H = 54, MAG_GAP = 10, BENCH_PAD = 10;
// 두 이름표 중심이 SNAP_DIST(px) 안이면 한 묶음으로 스냅. 묶음은 가로 한 줄(GRP_SLOT_W 간격).
const SNAP_DIST = 118, GRP_SLOT_W = 138;
interface DropTarget {
  id: string;            // unique key
  kind: DropKind;
  entryId?: string;      // queued entry id (for kind === 'queue'/'queue-card')
  courtId?: string;      // court id (for kind === 'court' — 모드2 코트 드롭존)
  slotIndex: number;     // 0..3 for tray/queue; the queue INDEX for 'queue-card'
  rect: { x: number; y: number; w: number; h: number };
}

// 방금 나온(recentlyOut) 누적 목록의 최대 보관 개수. 끝난 게임이 대기 명단 맨 아래에 '계속'
// 쌓여야 해서 넉넉히 보관(한 정모 분량). 너무 오래된 것만 떨궈 무한 증가 방지.
const RECENT_OUT_MAX = 50;

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

  // Measured width of a player-pool grid (the inner wrap row inside a pool box,
  // padding already subtracted) → drives the pool-grid column count so each pool
  // card stays wide enough that 2–4 char Korean names never clip. Mirrors the
  // court measurement above. All pool grids are the same width, so one measure
  // (the latest) sizes them all.
  const [poolAreaWidth, setPoolAreaWidth] = useState(0);
  const onPoolAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setPoolAreaWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);
  const POOL_GAP = spacing.xs; // must match styles.poolGrid gap
  const poolColumns = poolColumnsFor(poolAreaWidth || (twoPane ? 320 : layout.width));
  // Exact px width per pool card from the measured grid width + column count.
  // 1-col → full width (undefined → falls back to the flex cell). Memoized.
  const poolCellWidth = useMemo(() => {
    if (!poolAreaWidth || poolColumns <= 1) return undefined;
    return Math.floor((poolAreaWidth - POOL_GAP * (poolColumns - 1)) / poolColumns);
  }, [poolAreaWidth, poolColumns, POOL_GAP]);
  // Per-card override applied on top of styles.poolCell. When we have a measured
  // pixel width use it (exact columns, no rounding gaps); at 1-col stretch full
  // width; before first measure fall back to the static 48.5% in styles.poolCell.
  const poolCellStyle = useMemo<{ width: number } | { width: '100%' } | null>(() => {
    if (poolCellWidth) return { width: poolCellWidth };
    if (poolAreaWidth && poolColumns <= 1) return { width: '100%' };
    return null;
  }, [poolCellWidth, poolAreaWidth, poolColumns]);

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

  // ─── Live clock for the per-court "N분 진행 중" elapsed timer ───
  // A lightweight ticker: every 30s we bump `nowTs` so any court card showing an
  // elapsed badge re-renders with the fresh now − startedAt value. The interval
  // is cleared on unmount (WEB-SAFE — plain setInterval, no native deps). This is
  // the ONLY periodic render; it never touches the compose/drag state.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // Permission self-guard (per-club role, NOT the global gate)
  const [roleState, setRoleState] = useState<RoleState>('loading');

  // Staging tray (build a new queued game)
  const [staged, setStaged] = useState<string[]>([]);
  // 선수 검색: 출석 풀에서 이름으로 빠르게 찾아 다음 게임에 편성. 비어 있으면 전체
  // 표시. 표시할 때 trim + 소문자로 정규화해 대소문자 무시 부분일치로 거른다.
  const [poolSearch, setPoolSearch] = useState('');
  // ─── 풀 다중 필터 (이름검색 위에 얹는 속성 필터) ───
  // 급수(S~F + 'none' 미설정) · 성별(M/F) 다중선택, 게임수 구간 단일선택. 모두 비어
  // 있으면 '전체'. matchesPoolFilters 가 이름검색까지 한데 묶어 판정한다. 3분할/전체
  // 보기(그리고 이후 모드2 게임판)가 같은 predicate 를 공유한다.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSkills, setFilterSkills] = useState<Set<string>>(new Set());
  const [filterGenders, setFilterGenders] = useState<Set<'M' | 'F'>>(new Set());
  const [filterGames, setFilterGames] = useState<'all' | '0' | '1-2' | '3+'>('all');

  // ─── 운영판 모드 (1=현행 3분할 / 2=게임판 레이아웃) ───
  // 운영자마다 편한 UI가 달라 탭으로 전환. 두 모드는 같은 서버 보드 상태의 두 '뷰'라
  // (board/courts/players + 소켓 구독·핸들러 공유) 전환만으로 계속 sync 된다. 정모별로
  // 마지막 선택을 저장(웹 localStorage / 네이티브 SecureStore)해 새로고침에도 유지.
  const [boardMode, setBoardMode] = useState<1 | 2>(1);
  const boardModeKey = clubSessionId ? `operate_board_mode_${clubSessionId}` : null;
  const boardModeLoadedRef = useRef(false);
  useEffect(() => {
    if (!boardModeKey) return;
    let alive = true;
    getItem(boardModeKey)
      .then((raw) => { if (alive && (raw === '1' || raw === '2')) setBoardMode(raw === '2' ? 2 : 1); })
      .catch(() => {})
      .finally(() => { boardModeLoadedRef.current = true; });
    return () => { alive = false; };
  }, [boardModeKey]);
  useEffect(() => {
    if (!boardModeKey || !boardModeLoadedRef.current) return;
    setItem(boardModeKey, String(boardMode)).catch(() => {});
  }, [boardMode, boardModeKey]);
  // 모드 전환 시 선택/추천/코트 draft 초기화(모드 1 트레이 ↔ 모드 2 게임판 혼동 방지).
  useEffect(() => {
    setStaged([]);
    setSuggestNote(null);
    setModeChooserOpen(false);
    setCourtDrafts({});
  }, [boardMode]);

  // ─── 2분할(편성 ↔ 코트·큐) 크기 조절 ───
  // divider를 드래그해 왼쪽(선수 편성/풀) 폭을 px로 조정. null=기존 38% 기본.
  // 정모별 영속화. 모드 1·모드 2 twoPane 분할이 같은 값을 공유한다.
  const SPLIT_MIN_LEFT = 340;   // leftPane.minWidth 와 일치
  const SPLIT_MIN_RIGHT = 360;  // 오른쪽(코트·큐)이 안 찌부러지는 최소
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);
  const [splitWidth, setSplitWidth] = useState(0);
  const splitWidthKey = clubSessionId ? `operate_split_w_${clubSessionId}` : null;
  const splitLoadedRef = useRef(false);
  const splitWidthRef = useRef(0);
  splitWidthRef.current = splitWidth;
  const leftPaneWidthRef = useRef<number | null>(null);
  leftPaneWidthRef.current = leftPaneWidth;
  const dragStartLeftRef = useRef(0);
  useEffect(() => {
    if (!splitWidthKey) return;
    let alive = true;
    getItem(splitWidthKey)
      .then((raw) => {
        if (!alive) return;
        const n = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n > 0) setLeftPaneWidth(n);
      })
      .catch(() => {})
      .finally(() => { splitLoadedRef.current = true; });
    return () => { alive = false; };
  }, [splitWidthKey]);
  useEffect(() => {
    if (!splitWidthKey || !splitLoadedRef.current || leftPaneWidth == null) return;
    setItem(splitWidthKey, String(Math.round(leftPaneWidth))).catch(() => {});
  }, [leftPaneWidth, splitWidthKey]);
  const onSplitLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setSplitWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);
  // 드래그 중 폭 적용(클램프). ref만 읽어 한 번 만든 PanResponder에서도 최신값 사용.
  const applyLeftWidth = useCallback((px: number) => {
    const sw = splitWidthRef.current;
    const maxLeft = sw > 0 ? sw - SPLIT_MIN_RIGHT : px;
    const clamped = Math.max(SPLIT_MIN_LEFT, Math.min(px, Math.max(SPLIT_MIN_LEFT, maxLeft)));
    setLeftPaneWidth(clamped);
  }, []);
  // 분할 divider 드래그 — 웹·네이티브 공용 PanResponder(RN-web가 마우스도 처리).
  const dividerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartLeftRef.current = leftPaneWidthRef.current ?? Math.round((splitWidthRef.current || 0) * 0.38);
      },
      onPanResponderMove: (_e, g) => {
        applyLeftWidth(dragStartLeftRef.current + g.dx);
      },
    }),
  ).current;
  // 모드2 오른쪽 '대기 명단' 폭 — 디바이더 드래그로 조절(모드1 분할처럼). 왼쪽으로 끌면 넓어짐.
  const [m2RightWidth, setM2RightWidth] = useState(500);
  const m2RightWidthRef = useRef(500); m2RightWidthRef.current = m2RightWidth;
  const m2DragStartRef = useRef(500);
  const m2DividerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { m2DragStartRef.current = m2RightWidthRef.current; },
      onPanResponderMove: (_e, g) => { setM2RightWidth(Math.max(280, Math.min(820, m2DragStartRef.current - g.dx))); },
    }),
  ).current;
  // 출석 풀 보기 전환: 'group' = 미편성/편성됨/게임중 3분할(기본), 'all' = 전체를
  // 가나다 한 줄 목록으로 묶고 각 카드에 편성 상태 배지를 붙인다. 'recent' = 방금
  // 끝난 게임들을 게임 단위(함께 친 4명)로 묶어 보여줘 새 조합으로 바로 다시 편성.
  // 검색/정렬/그리드 측정은 group/all 보기에서 동일하게 동작한다.
  const [poolTab, setPoolTab] = useState<'group' | 'all' | 'recent'>('group');

  // ─── 방금 나온(recentlyOut): 막 끝난 게임들의 4인 묶음 ───
  // 게임 종료(게임 종료 → completeTurn) 직전에 그 코트의 4명 playerIds 를 캡처해
  // 가장 최근이 앞으로 오도록 unshift. 최대 ~6개만 유지. 새로고침에도 남도록
  // sessionStorage(웹)/storage 유틸(네이티브)에 정모 id 로 키해 영속화한다. names 는
  // 풀에서 빠진 사람을 위한 폴백(캡처 시점의 이름)으로 함께 저장한다.
  type RecentOut = { id: string; playerIds: string[]; names: Record<string, string>; at: number };
  const [recentlyOut, setRecentlyOut] = useState<RecentOut[]>([]);
  // 영속화 키 — 정모별로 분리. 웹은 sessionStorage, 네이티브는 storage 유틸.
  const recentOutKey = clubSessionId ? `operate_recent_out_${clubSessionId}` : null;
  // 마운트 시 1회 로드. 로드가 끝났는지 표시해 그 전에 저장이 덮어쓰지 않게 한다.
  const recentLoadedRef = useRef(false);

  // ─── 방금 나온 로드/영속화 ───
  // 마운트(정모 id 확정) 시 1회 저장소에서 읽어와 복원. 파싱 실패/형식 불일치는
  // 조용히 빈 목록으로 폴백한다. 로드가 끝나야 영속화 effect 가 덮어쓰기를 시작한다.
  useEffect(() => {
    if (!recentOutKey) return;
    let alive = true;
    getItem(recentOutKey)
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const clean = parsed
                .filter((e: any) => e && Array.isArray(e.playerIds) && typeof e.at === 'number')
                .map((e: any) => ({
                  id: String(e.id ?? `${e.at}`),
                  playerIds: e.playerIds.map((p: any) => String(p)),
                  names: e.names && typeof e.names === 'object' ? e.names : {},
                  at: e.at,
                }))
                .slice(0, RECENT_OUT_MAX);
              setRecentlyOut(clean);
            }
          } catch {
            // 형식 깨짐 → 빈 목록 유지(앱은 정상 동작).
          }
        }
      })
      .catch(() => {})
      .finally(() => { recentLoadedRef.current = true; });
    return () => { alive = false; };
  }, [recentOutKey]);

  // 변경 시 저장. 최초 로드 완료 전에는 저장하지 않아(빈 초기 상태로) 디스크를
  // 덮어쓰지 않는다. 직렬화 실패는 무시(영속화는 best-effort, 메모리 상태가 진실).
  useEffect(() => {
    if (!recentOutKey || !recentLoadedRef.current) return;
    setItem(recentOutKey, JSON.stringify(recentlyOut)).catch(() => {});
  }, [recentlyOut, recentOutKey]);

  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestUnavailable, setSuggestUnavailable] = useState(false);
  // 자동 추천 모드 칩 표시 여부 (🎲 자동 추천 탭 시 토글).
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const bounceAnims = useRef([0, 1, 2, 3].map(() => new RNAnimated.Value(1))).current;

  // Modals
  const [guestModal, setGuestModal] = useState(false);
  const [feeModal, setFeeModal] = useState(false);
  const [courtModal, setCourtModal] = useState(false);
  // 테스트/데모용 랜덤 게스트 일괄 추가 진행 상태 (실제 출석 아님).
  const [addingTestGuests, setAddingTestGuests] = useState(false);
  // Matchup popup: the player whose "오늘 함께 친 사람" sheet is open (null = closed).
  const [matchupTarget, setMatchupTarget] = useState<{ userId: string; name: string; skillLevel?: string | null; isGuest?: boolean } | null>(null);

  // Swap: { entryId, slotIndex } of the queued-game slot being replaced
  const [swapTarget, setSwapTarget] = useState<{ entryId: string; slotIndex: number } | null>(null);
  // 게임 중(PLAYING) 코트에서 선수 1명 교체: 그 코트의 turnId + 빠질 선수 + 현재 4명(제외용).
  const [runningSwap, setRunningSwap] = useState<{ turnId: string; outUserId: string; courtName: string; currentIds: string[] } | null>(null);
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
      const hit = hitTestDrop(x, y, ['tray', 'queue', 'court', 'frame', 'pool']);
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
  const { playingPool, queuedPool, freePool, lessonPool } = useMemo(() => {
    // 가나다 순(ㄱㄴㄷ) — 한국어 콜레이션으로 이름 정렬. 게스트도 동일. .slice()로
    // 원본을 변형하지 않고 정렬한다.
    const byName = (a: Player, b: Player) =>
      (a.userName || '').localeCompare(b.userName || '', 'ko-KR');
    const playingP: Player[] = [];
    const queuedP: Player[] = [];
    const freeP: Player[] = [];
    const lessonP: Player[] = [];
    for (const p of uniquePlayers) {
      // 게임 중이면 레슨 여부와 무관하게 '게임 중'(수동 배정으로 코트에 있을 수 있음).
      if (p.status === 'IN_TURN') { playingP.push(p); continue; }
      // 레슨 중(비-게임) → 레슨자 박스로 분리(미편성/편성 풀에서 제외).
      if (p.isInLesson) { lessonP.push(p); continue; }
      if (queuedPlayerIds.has(p.userId)) { queuedP.push(p); continue; }
      freeP.push(p);
    }
    return {
      playingPool: playingP.slice().sort(byName),
      queuedPool: queuedP.slice().sort(byName),
      freePool: freeP.slice().sort(byName),
      lessonPool: lessonP.slice().sort(byName),
    };
  }, [uniquePlayers, queuedPlayerIds]);

  // 모드 2 게임판에 보일 사람들 = 출석 전원 − 레슨자(비-게임). 가나다 정렬.
  const gamePanelPlayers = useMemo(() => {
    const byName = (a: Player, b: Player) =>
      (a.userName || '').localeCompare(b.userName || '', 'ko-KR');
    return uniquePlayers
      .filter((m) => !(m.isInLesson && m.status !== 'IN_TURN'))
      .slice()
      .sort(byName);
  }, [uniquePlayers]);

  // ─── 전체 보기용 단일 목록 ───
  // 출석한 모든 사람을 가나다(ko-KR) 한 줄로 합치고, 각 사람의 현재 편성 상태
  // (free=미편성 / queued=편성됨 / playing=게임 중)를 함께 들고 다닌다. 3분할과
  // 동일한 분류 규칙(게임 중 우선 → 편성됨 → 미편성)을 그대로 쓴다. 미편성만
  // 다음 게임에 편성 가능(stageable) — 3분할의 미편성 박스와 같은 동작.
  const allPool = useMemo<{ player: Player; poolStatus: 'free' | 'queued' | 'playing' }[]>(() => {
    const byName = (a: Player, b: Player) =>
      (a.userName || '').localeCompare(b.userName || '', 'ko-KR');
    return uniquePlayers
      .slice()
      .sort(byName)
      .map((p) => {
        const poolStatus: 'free' | 'queued' | 'playing' =
          p.status === 'IN_TURN' ? 'playing' : queuedPlayerIds.has(p.userId) ? 'queued' : 'free';
        return { player: p, poolStatus };
      });
  }, [uniquePlayers, queuedPlayerIds]);

  // ─── 풀 필터 판정 (이름검색 + 급수 + 성별 + 게임수) ───
  // 한 선수가 현재 걸린 모든 필터를 통과하는지. 비어 있는 차원은 건너뛴다. 급수
  // 미설정은 'none' 키로 취급해 '미설정' 칩으로 거를 수 있게 한다. PoolBox/AllPoolBox
  // 가 공유한다.
  const matchesPoolFilters = useCallback((p: Player): boolean => {
    if (poolSearch && !(p.userName || '').toLowerCase().includes(poolSearch)) return false;
    if (filterSkills.size > 0) {
      const lv = p.skillLevel && (SKILL_LEVELS as string[]).includes(p.skillLevel) ? p.skillLevel : 'none';
      if (!filterSkills.has(lv)) return false;
    }
    if (filterGenders.size > 0) {
      if (!p.gender || !filterGenders.has(p.gender)) return false;
    }
    if (filterGames !== 'all') {
      const g = p.gamesPlayedToday ?? 0;
      const ok = filterGames === '0' ? g === 0 : filterGames === '1-2' ? g >= 1 && g <= 2 : g >= 3;
      if (!ok) return false;
    }
    return true;
  }, [poolSearch, filterSkills, filterGenders, filterGames]);

  // 속성 필터(급수/성별/게임수) 개수 — 토글 배지에 표시. 이름검색은 별도 줄이라 제외.
  const activeFilterCount = useMemo(
    () => filterSkills.size + filterGenders.size + (filterGames !== 'all' ? 1 : 0),
    [filterSkills, filterGenders, filterGames],
  );
  // 어떤 거름(검색 OR 속성 필터)이라도 걸려 있나 — 카운트 표시/빈 문구를 바꾸는 데 쓴다.
  const filtersActive = useMemo(
    () => poolSearch.length > 0 || activeFilterCount > 0,
    [poolSearch, activeFilterCount],
  );
  const clearPoolFilters = useCallback(() => {
    setFilterSkills(new Set());
    setFilterGenders(new Set());
    setFilterGames('all');
  }, []);
  // 급수/성별 칩 토글 — 들어있으면 빼고 없으면 넣는다(불변 복사).
  const toggleFilterSkill = useCallback((lv: string) => {
    setFilterSkills((prev) => {
      const next = new Set(prev);
      next.has(lv) ? next.delete(lv) : next.add(lv);
      return next;
    });
  }, []);
  const toggleFilterGender = useCallback((g: 'M' | 'F') => {
    setFilterGenders((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }, []);

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
      // Exclude players already STAGED in the tray + those already placed in a
      // QUEUED upcoming game, so building game-after-game uses fresh people.
      const exclude = Array.from(new Set([...staged, ...queuedPlayerIds]));
      const { playerIds, effectiveMode, note } = await suggestNext({ mode, exclude });
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
  }, [suggestNext, prefillStaged, staged, queuedPlayerIds]);

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

  // ─── 모드 2: 선택(staged) 인원을 빈 코트에 바로 내려 즉시 시작 ───
  // 큐에 새 게임을 만들고(createQueueGame) 그 엔트리를 곧바로 코트에 배정(assignEntry)
  // = 모드 1의 2단계를 한 동작으로. 인원<2면 친절 안내. 성공 시 선택 초기화 + 갱신.
  const handlePlaceSelectedOnCourt = useCallback(async (courtId: string) => {
    if (staged.length < 2) { showAlert('알림', '최소 2명을 선택해주세요'); return; }
    const court = courts.find((c) => c.id === courtId);
    try {
      const entry = await createQueueGame(staged);
      if (!entry?.id) throw new Error('entry');
      await assignEntry(entry.id, courtId);
      setStaged([]);
      setSuggestNote(null);
      loadBoard();
      loadCourts();
      loadPool();
      showSuccess(`${court?.name || '코트'}에서 게임 시작!`);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '게임 시작에 실패했어요');
    }
  }, [staged, courts, createQueueGame, assignEntry, loadBoard, loadCourts, loadPool]);

  // ─── 모드 2: 코트 드롭존 편성 (draft) ───
  // 게임판에서 4명 선택 → 그룹을 코트로 드래그(또는 코트 탭) → 그 코트에 '편성 중'
  // draft 로 올린다(아직 시작 X). 코트의 "게임 시작" 버튼을 눌러야 실제 게임이 시작된다.
  // draft 는 클라이언트 임시 상태(빈 코트 한정) — 시작 시 createQueueGame→assignEntry 로
  // 확정되며 그때 소켓으로 양쪽 모드·다른 운영판에 동기화된다.
  const [courtDrafts, setCourtDrafts] = useState<Record<string, string[]>>({});
  const draftCourt = useCallback((courtId: string, ids: string[]) => {
    if (ids.length === 0) return;
    animateNext();
    // 기존 draft에 '추가'(append) — 중복 제거, 최대 4명. 한 번에 4명 드롭하면 그대로,
    // 한 명씩 더 끌어오면 채워진다("게임판에서 더 끌어올 수 있어요").
    setCourtDrafts((prev) => {
      const merged = Array.from(new Set([...(prev[courtId] || []), ...ids])).slice(0, 4);
      return { ...prev, [courtId]: merged };
    });
    setStaged([]);
    setSuggestNote(null);
  }, []);
  const clearCourtDraft = useCallback((courtId: string) => {
    animateNext();
    setCourtDrafts((prev) => {
      if (!(courtId in prev)) return prev;
      const n = { ...prev }; delete n[courtId]; return n;
    });
  }, []);
  const removeFromCourtDraft = useCallback((courtId: string, idx: number) => {
    animateNext();
    setCourtDrafts((prev) => {
      const cur = prev[courtId];
      if (!cur) return prev;
      const next = cur.filter((_, i) => i !== idx);
      const n = { ...prev };
      if (next.length === 0) delete n[courtId]; else n[courtId] = next;
      return n;
    });
  }, []);
  // draft 를 실제 게임으로: createQueueGame→assignEntry(한 동작). 성공 시 draft 비움.
  const startCourtDraft = useCallback(async (courtId: string) => {
    const ids = courtDrafts[courtId] || [];
    if (ids.length < 2) { showAlert('알림', '최소 2명이 필요해요'); return; }
    const court = courts.find((c) => c.id === courtId);
    try {
      const entry = await createQueueGame(ids);
      if (!entry?.id) throw new Error('entry');
      await assignEntry(entry.id, courtId);
      clearCourtDraft(courtId);
      loadBoard();
      loadCourts();
      loadPool();
      showSuccess(`${court?.name || '코트'} 게임 시작!`);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '게임 시작에 실패했어요');
    }
  }, [courtDrafts, courts, createQueueGame, assignEntry, clearCourtDraft, loadBoard, loadCourts, loadPool]);

  // (모드2 자석판 묶음 핸들러는 commitTagFrac 정의 뒤로 이동 — 아래 참조)

  // ─── 모드 2: 자유 캔버스 자석판 ───
  // 이름표를 캔버스 아무 좌표에나 자유 배치(분수 x,y 저장). 상단 코트 칸(드롭존)에
  // 이름표를 끌어넣어 4명 차면 그 칸에서 "게임 시작". 위치는 정모별로 저장(Phase A
  // device 로컬, Phase B 서버 동기화). court 소속은 좌표→칸 rect 히트테스트로 유도.
  const [tagPos, setTagPos] = useState<Record<string, { x: number; y: number }>>({});
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  // 자석 이름표 릴리즈(한 번 만든 PanResponder)에서 최신 명단 영역 크기로 좌표 변환하기 위한 ref.
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const tagPosKey = clubSessionId ? `operate_tags_${clubSessionId}` : null;
  const tagPosLoadedRef = useRef(false);
  useEffect(() => {
    if (!tagPosKey) return;
    let alive = true;
    getItem(tagPosKey)
      .then((raw) => {
        if (!alive || !raw) return;
        try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') setTagPos(parsed); } catch { /* ignore */ }
      })
      .catch(() => {})
      .finally(() => { tagPosLoadedRef.current = true; });
    return () => { alive = false; };
  }, [tagPosKey]);
  useEffect(() => {
    if (!tagPosKey || !tagPosLoadedRef.current) return;
    setItem(tagPosKey, JSON.stringify(tagPos)).catch(() => {});
  }, [tagPos, tagPosKey]);
  const onCanvasLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvasSize((prev) => (Math.abs(prev.w - width) > 1 || Math.abs(prev.h - height) > 1 ? { w: width, h: height } : prev));
  }, []);
  // 서버 공유: board.id 를 ref 로 들고(한 번 만든 PanResponder 에서도 최신값), 드래그
  // 릴리즈마다 위치를 PATCH → 소켓으로 다른 운영진에 전파.
  const boardIdRef = useRef<string | undefined>(undefined);
  boardIdRef.current = board?.id;
  const commitTagFrac = useCallback((userId: string, x: number, y: number) => {
    const fx = Math.max(0, Math.min(1, x));
    const fy = Math.max(0, Math.min(1, y));
    setTagPos((prev) => ({ ...prev, [userId]: { x: fx, y: fy } }));
    const bid = boardIdRef.current;
    if (bid) gameBoardApi.updateLayout(bid, userId, fx, fy).catch(() => {});
  }, []);
  // 서버 자석판 배치를 초기 1회 seed(서버가 공유 진실, 로컬은 폴백). 이후 소켓으로 동기화.
  const tagSeededRef = useRef(false);
  useEffect(() => {
    if (tagSeededRef.current) return;
    const layout = board?.tagLayout;
    if (layout && Object.keys(layout).length > 0) {
      setTagPos((prev) => ({ ...prev, ...layout }));
      tagSeededRef.current = true;
    }
  }, [board?.tagLayout]);
  // 다른 운영진이 이름표를 옮기면 실시간 반영(소켓).
  const handleLayoutUpdated = useCallback((msg: any) => {
    if (!msg || typeof msg.userId !== 'string' || typeof msg.x !== 'number') return;
    setTagPos((prev) => ({ ...prev, [msg.userId]: { x: msg.x, y: msg.y } }));
  }, []);
  useSocketEvent('gameBoard:layoutUpdated', handleLayoutUpdated);

  // ─── 모드2 게임판: 번호 매겨진 게임 칸(틀)에 풀에서 탭으로 넣고/빼고. 친 사람은 풀 아래로.
  // 꽉 찬 칸을 코트에 투입(createQueueGame→assignEntry). gameFrames = 칸별 4명(클라 초안). ───
  // ─── 모드 2 = 서버 공유 '다음 게임 큐'(queuedEntries) 기반 — 모드1·다른 운영진과 연동 ───
  // 탭으로 옮기기: 선수 선택 → 옮길 게임/대기/코트 탭. 모든 변경은 서버 큐(updateEntry 등).
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  // 대기로 '직접 내려놓은' 사람들 — 대기 명단 맨 아래에 이 순서대로 둔다(루미큐브식 재배치).
  const [poolBottom, setPoolBottom] = useState<string[]>([]);
  // 대기 명단 '안정 슬롯' — 한 명 빼도 그 자리는 빈칸으로 유지(갑자기 재정렬 X). 급수→이름 시드.
  const poolSlotsRef = useRef<(string | null)[]>([]);
  // 대기 명단 전용 검색/필터(이름 + 성별 + 급수). 가운데 게임은 그대로 두고 대기만 추린다.
  // 성별/급수는 '다중선택' — 빈 배열이면 전체. 칩 탭으로 토글, '전체'는 비움.
  const [poolQuery, setPoolQuery] = useState('');
  // 텍스트 명령창 — "신예준 김도윤 이지유 강수아"(편성) / "코트1 …"(투입) / "신예준 급수 A"(수정).
  // 평소엔 접어두고(작은 버튼) 탭하면 입력창이 올라온다(공간 적게).
  const [cmd, setCmd] = useState('');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [poolGenders, setPoolGenders] = useState<string[]>([]);
  const [poolSkills, setPoolSkills] = useState<string[]>([]);
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const autoFilledRef = useRef(false);

  // 선택 선수를 큐의 한 게임(entryId)으로 이동. 대상이 4명이면 마지막 1명을 대기로 밀어냄(스왑).
  // entryId===null 이면 새 게임 생성. 원래 게임에선 빠져 빈자리로 남는다(자동 안 채움).
  // 코어 이동(탭·드래그 공용): 선수 P를 큐 게임(entryId)으로. 4명이면 마지막 1명을 대기로(스왑). null=새 게임.
  const moveToGame = useCallback(async (P: string, entryId: string | null, dropSlot?: number) => {
    const cur = queuedEntries.find((e) => e.playerIds.includes(P));
    if (cur && cur.id === entryId) return;
    try {
      if (cur) {
        const rest = cur.playerIds.filter((x) => x !== P);
        if (rest.length === 0) await deleteEntry(cur.id); else await updateEntry(cur.id, rest);
      }
      if (entryId === null) {
        await createQueueGame([P]);
        setSelectedPlayer(null); // 새 게임에 안착 → 잡기 해제(체인 종료)
        showSuccess(`${getPlayer(P)?.userName || '선수'} → 새 게임`);
      } else {
        const target = queuedEntries.find((e) => e.id === entryId); if (!target) { loadBoard(); return; }
        const without = target.playerIds.filter((x) => x !== P);
        let bumped: string | null = null;
        let newIds: string[];
        if (without.length >= 4) {
          // 4명이면 '드롭한 그 자리' 사람을 밀어내고 그 자리를 P가 차지(드래그). 슬롯 없으면 마지막.
          const slot = (dropSlot != null && dropSlot >= 0 && dropSlot < without.length) ? dropSlot : without.length - 1;
          bumped = without[slot];
          newIds = without.slice(); newIds[slot] = P;
        } else {
          newIds = [...without, P];
        }
        await updateEntry(entryId, newIds);
        const num = queuedEntries.findIndex((e) => e.id === entryId) + 1;
        // 루미큐브식: 밀려난 사람이 있으면 그 사람을 곧장 '잡힌(선택)' 상태로 — 어디 놓을지 계속 정함.
        // 밀려난 사람이 없으면(빈자리에 안착) 잡기 해제 → 체인 종료. (탭·드래그 경로 공통으로 정리)
        if (bumped) { setSelectedPlayer(bumped); showSuccess(`${getPlayer(bumped)?.userName || '선수'} 밀려남 — 이어서 놓을 곳(게임/대기)을 탭/드래그`); }
        else { setSelectedPlayer(null); showSuccess(`${getPlayer(P)?.userName || '선수'} → ${num}번째 게임`); }
      }
      setPoolBottom((prev) => prev.filter((x) => x !== P)); // 게임에 들어갔으니 대기-맨아래 목록에서 제거
      loadBoard(); loadPool();
    } catch (err: any) { showAlert('오류', err?.response?.data?.error || '이동 실패'); loadBoard(); }
  }, [queuedEntries, updateEntry, deleteEntry, createQueueGame, loadBoard, loadPool]);
  const moveToPool = useCallback(async (P: string) => {
    setSelectedPlayer(null); // 대기에 내려놓음 → 잡기 해제(체인 종료)
    setPoolBottom((prev) => [...prev.filter((x) => x !== P), P]); // 대기 맨 아래로
    const cur = queuedEntries.find((e) => e.playerIds.includes(P));
    if (!cur) { showSuccess(`${getPlayer(P)?.userName || '선수'} → 대기 맨 아래`); return; }
    try {
      const rest = cur.playerIds.filter((x) => x !== P);
      if (rest.length === 0) await deleteEntry(cur.id); else await updateEntry(cur.id, rest);
      showSuccess(`${getPlayer(P)?.userName || '선수'} → 대기 맨 아래`);
      loadBoard(); loadPool();
    } catch (err: any) { showAlert('오류', err?.response?.data?.error || '빼기 실패'); loadBoard(); }
  }, [queuedEntries, updateEntry, deleteEntry, loadBoard, loadPool]);
  // 탭(선택) 래퍼 — 게임 이동은 선택 유지하다 밀려난 사람으로 넘어감(체인), 대기로 내려놓으면 선택 해제.
  const moveSelectedToGame = useCallback((entryId: string | null) => { const P = selectedPlayer; if (!P) return; setSelectedPlayer(null); moveToGame(P, entryId); }, [selectedPlayer, moveToGame]);
  const removeSelectedToPool = useCallback(() => { const P = selectedPlayer; if (!P) return; setSelectedPlayer(null); moveToPool(P); }, [selectedPlayer, moveToPool]);

  // 선택 선수 P를 '탭한 게임 선수 X' 자리와 스왑: P가 X 자리 차지, X는 대기로. P의 원래 게임은 빈자리.
  const swapSelectedWith = useCallback(async (targetUserId: string) => {
    const P = selectedPlayer; if (!P || P === targetUserId) { setSelectedPlayer(null); return; }
    setSelectedPlayer(null);
    const pGame = queuedEntries.find((e) => e.playerIds.includes(P));
    const xGame = queuedEntries.find((e) => e.playerIds.includes(targetUserId));
    if (!xGame) return; // 타깃이 큐 게임에 없으면(대기/게임중) 스왑 대상 아님
    if (pGame && pGame.id === xGame.id) return; // 같은 게임 내 — 무시
    try {
      if (pGame) await updateEntry(pGame.id, pGame.playerIds.filter((u) => u !== P)); // P 원래 게임 빈자리(3명)
      await updateEntry(xGame.id, xGame.playerIds.map((u) => (u === targetUserId ? P : u))); // X 자리에 P
      showSuccess(`${getPlayer(P)?.userName || ''} ↔ ${getPlayer(targetUserId)?.userName || ''}(대기로)`);
      loadBoard(); loadPool();
    } catch (err: any) { showAlert('오류', err?.response?.data?.error || '스왑 실패'); loadBoard(); }
  }, [selectedPlayer, queuedEntries, updateEntry, loadBoard, loadPool]);

  // 자동 편성: 주어진 대기 인원을 4명씩 큐 게임으로 생성.
  const autoFillQueue = useCallback(async (poolUserIds: string[]) => {
    if (poolUserIds.length < 4) { showAlert('알림', '편성할 4명이 부족해요'); return; }
    try {
      for (let i = 0; i + 4 <= poolUserIds.length; i += 4) await createQueueGame(poolUserIds.slice(i, i + 4));
      loadBoard(); loadPool();
    } catch (err: any) { showAlert('오류', err?.response?.data?.error || '자동 편성 실패'); loadBoard(); }
  }, [createQueueGame, loadBoard, loadPool]);

  // 빈 코트 탭 → 투입 가능한(4명·게임중 없음) 첫 큐 게임(또는 지정 entry)을 그 코트에 투입.
  const assignQueueToCourt = useCallback(async (courtId: string, candidateEntryId?: string) => {
    const playing = new Set<string>();
    playingByCourtId.forEach((e) => (e.playerIds || []).forEach((id) => playing.add(id)));
    const e = candidateEntryId
      ? queuedEntries.find((en) => en.id === candidateEntryId)
      : queuedEntries.find((en) => en.playerIds.length === 4 && en.playerIds.every((u) => !playing.has(u)));
    if (!e || e.playerIds.length !== 4) { showAlert('알림', '투입할 4명짜리 게임이 없어요'); return; }
    const court = courts.find((c) => c.id === courtId);
    try {
      await assignEntry(e.id, courtId);
      loadBoard(); loadCourts(); loadPool();
      showSuccess(`${court?.name || '코트'} 게임 시작!`);
    } catch (err: any) { showAlert('오류', err?.response?.data?.error || '코트 투입 실패'); loadBoard(); }
  }, [queuedEntries, playingByCourtId, courts, assignEntry, loadBoard, loadCourts, loadPool]);

  // ─── 텍스트 명령 ───  "이름 이름 …"=편성 · "코트N 이름 …"=투입 · "이름 급수 X"=급수 수정
  // 이름은 출석자 명단과 완전일치 우선→부분일치. 0명/여러 명이면 알려주고 실행 안 함.
  const runCommand = useCallback(async () => {
    const raw = cmd.trim();
    if (!raw) return;
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const matchName = (tk: string): { id?: string; err?: string } => {
      const t = tk.toLowerCase();
      const ex = uniquePlayers.filter((m) => (m.userName || '').toLowerCase() === t);
      if (ex.length === 1) return { id: ex[0].userId };
      const pa = uniquePlayers.filter((m) => (m.userName || '').toLowerCase().includes(t));
      if (pa.length === 1) return { id: pa[0].userId };
      if (pa.length === 0) return { err: `'${tk}' 없음` };
      return { err: `'${tk}' 여러 명(${pa.slice(0, 4).map((m) => m.userName).join('/')}) — 더 정확히` };
    };
    // 1) 급수 수정: "이름 급수 X"
    const gi = tokens.findIndex((t) => t === '급수');
    if (gi > 0 && tokens[gi + 1]) {
      const r = matchName(tokens[gi - 1]);
      if (r.err) { showAlert('명령', r.err); return; }
      const lvl = tokens[gi + 1].toUpperCase();
      try { await clubSessionApi.editPlayer(clubSessionId, r.id!, { skillLevel: lvl }); loadPool(); loadBoard(); setCmd(''); showSuccess(`급수 수정 → ${lvl}`); }
      catch (e: any) { showAlert('오류', e?.response?.data?.error || '수정 실패'); }
      return;
    }
    // 2) 코트 투입: 첫 토큰이 "코트N"/"cN"
    let courtId: string | null = null;
    let names = tokens;
    const cm = tokens[0].match(/^코트\s*(\d+)$/) || tokens[0].match(/^c(\d+)$/i);
    if (cm) {
      const court = courts.find((c) => (c.name || '').replace(/\s/g, '') === `코트${cm[1]}`);
      if (!court) { showAlert('명령', `'${tokens[0]}' 코트가 없어요`); return; }
      courtId = court.id; names = tokens.slice(1);
    }
    // 3) 이름들 → 편성(+투입)
    const ids: string[] = []; const errs: string[] = [];
    for (const tk of names) { const r = matchName(tk); if (r.id) { if (!ids.includes(r.id)) ids.push(r.id); } else errs.push(r.err!); }
    if (errs.length) { showAlert('명령', errs.join('\n')); return; }
    if (ids.length === 0) { showAlert('명령', '이름을 입력하세요 (예: 신예준 김도윤 이지유 강수아)'); return; }
    try {
      const entry: any = await createQueueGame(ids);
      if (courtId && entry?.id) await assignEntry(entry.id, courtId);
      loadBoard(); loadPool(); loadCourts(); setCmd('');
      showSuccess(courtId ? `코트 투입 (${ids.length}명)` : `편성 (${ids.length}명)`);
    } catch (e: any) { showAlert('오류', e?.response?.data?.error || '편성 실패'); loadBoard(); }
  }, [cmd, uniquePlayers, courts, createQueueGame, assignEntry, loadBoard, loadPool, loadCourts, clubSessionId]);

  // 첫 진입 시 큐가 비어있고 대기 인원 4명+면 자동 편성 1회(이후엔 '자동 편성' 버튼). 큐가 있으면 안 함.
  useEffect(() => {
    if (autoFilledRef.current) return;
    if (queuedEntries.length > 0) { autoFilledRef.current = true; return; }
    const playing = new Set<string>();
    playingByCourtId.forEach((e) => (e.playerIds || []).forEach((id) => playing.add(id)));
    const waitingIds = uniquePlayers
      .filter((m) => !playing.has(m.userId))
      .sort((a, b) => (getPlayer(a.userId)?.gamesPlayedToday ?? 0) - (getPlayer(b.userId)?.gamesPlayedToday ?? 0))
      .map((m) => m.userId);
    if (waitingIds.length >= 4) { autoFilledRef.current = true; autoFillQueue(waitingIds); }
  }, [queuedEntries.length, uniquePlayers, playingByCourtId, autoFillQueue, getPlayer]);
  // 캔버스 코트 칸의 4명으로 실제 게임 시작(기존 createQueueGame→assignEntry 재사용).
  const handleStartCanvasGame = useCallback(async (courtId: string, userIds: string[]) => {
    if (userIds.length !== 4) { showAlert('알림', '코트 칸에 4명을 넣어주세요'); return; }
    const court = courts.find((c) => c.id === courtId);
    try {
      const entry = await createQueueGame(userIds);
      if (!entry?.id) throw new Error('entry');
      await assignEntry(entry.id, courtId);
      loadBoard(); loadCourts(); loadPool();
      showSuccess(`${court?.name || '코트'} 게임 시작!`);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '게임 시작에 실패했어요');
    }
  }, [courts, createQueueGame, assignEntry, loadBoard, loadCourts, loadPool]);

  // 게임 중 코트의 선수 1명을 교체(서버 replacePlayer). 성공 시 풀/보드/코트 갱신.
  const handleReplaceRunning = useCallback(async (replacementId: string) => {
    if (!runningSwap) return;
    try {
      await clubSessionApi.replacePlayer(runningSwap.turnId, runningSwap.outUserId, replacementId);
      setRunningSwap(null);
      loadBoard(); loadCourts(); loadPool();
      showSuccess('선수 교체 완료!');
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '선수 교체에 실패했어요');
    }
  }, [runningSwap, loadBoard, loadCourts, loadPool]);

  // ─── 게임 종료 (코트 위 게임 턴 완료) ───
  // ─── 방금 나온: 막 끝난 코트의 4명을 누적 목록에 쌓기 ───
  // 게임 종료가 성공한 직후 호출. 그 코트의 4명 playerIds 를 (보드 엔트리 → 코트
  // currentTurn 순으로) 잡아내고, 캡처 시점의 이름을 함께 저장(풀에서 빠진 사람용
  // 폴백). 가장 최근이 위로 오도록 unshift, 최대 RECENT_OUT_MAX 개 유지.
  //  - 2명 미만이면 스킵(의미 없는 빈 묶음 방지).
  //  - 직전 항목과 멤버가 완전히 같으면 중복으로 건너뜀(연타/중복 이벤트 방어).
  const pushRecentOut = useCallback((courtId: string) => {
    const court = courts.find((c) => c.id === courtId);
    const entry = playingByCourtId.get(courtId);
    const ids = (entry?.playerIds ?? court?.currentTurn?.playerIds ?? []).filter(Boolean);
    if (ids.length < 2) return;
    // 캡처 시점 이름: 현재 풀 → 보드 엔트리/코트 turn 의 playerNames 순으로 폴백.
    const turnNames = entry?.playerNames ?? court?.currentTurn?.playerNames ?? [];
    const names: Record<string, string> = {};
    ids.forEach((pid, i) => {
      const nm = getPlayer(pid)?.userName ?? turnNames[i];
      if (nm) names[pid] = nm;
    });
    setRecentlyOut((prev) => {
      // 직전 항목과 동일 멤버면 중복으로 보고 스킵(순서 무관 비교).
      const prevTop = prev[0];
      if (prevTop) {
        const a = [...prevTop.playerIds].sort().join('|');
        const b = [...ids].sort().join('|');
        if (a === b) return prev;
      }
      const next: RecentOut = {
        id: `${courtId}-${Date.now()}`,
        playerIds: ids,
        names,
        at: Date.now(),
      };
      return [next, ...prev].slice(0, RECENT_OUT_MAX);
    });
  }, [courts, playingByCourtId, getPlayer]);

  // 게임 종료 — COURT-based so it ALWAYS ends whatever's actually PLAYING on this
  // court. The server resolves the turn from the court (not a client turnId that
  // can desync) and completes it + cancels any leftover WAITING turn, freeing the
  // players. This is also the stuck-court recovery: a court that shows 게임 중 but
  // can't otherwise be cleared is freed here, so the assign guard stops blocking
  // those players. `forceClear` only changes the confirm copy (the endpoint is
  // robust either way).
  const handleEndGame = useCallback(
    (courtId: string, forceClear = false) => {
      const court = courts.find((c) => c.id === courtId);
      showConfirm(
        forceClear ? '코트 비우기' : '게임 종료',
        forceClear
          ? `${court?.name || '코트'}을(를) 강제로 비울까요? 진행 중인 게임이 종료되고 선수들이 풀려요.`
          : `${court?.name || '코트'}의 게임을 종료할까요?`,
        async () => {
          try {
            await courtApi.completeActiveByCourt(courtId);
            // 종료 성공 → 방금 나온 목록에 이 4명을 쌓는다(풀 갱신 전에 캡처).
            pushRecentOut(courtId);
            loadBoard();
            loadCourts();
            loadPool();
            showSuccess(forceClear ? '코트를 비웠어요' : '게임 종료!');
          } catch (err: any) {
            showAlert('오류', err.response?.data?.error || (forceClear ? '비우기 실패' : '종료 실패'));
          }
        },
        forceClear ? '비우기' : '종료', '취소', 'danger',
      );
    },
    [courts, loadBoard, loadCourts, loadPool, pushRecentOut],
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

  // ─── 정모 삭제 (HARD delete the whole session) ───
  // Distinct from 정모 종료 (end): this PERMANENTLY removes the 정모 and all of its
  // courts/turns/games/board/check-ins. TWO-step confirm, then navigate back out.
  const handleDeleteSession = useCallback(() => {
    if (!clubSessionId) return;
    showConfirm(
      '정모 삭제',
      '이 정모를 삭제할까요? 코트·게임·출석 기록이 영구 삭제됩니다.',
      () => {
        showConfirm(
          '정말 삭제할까요?',
          '이 작업은 되돌릴 수 없습니다.',
          async () => {
            try {
              await clubSessionApi.deleteSession(clubSessionId);
              setCourtModal(false);
              showSuccess('정모를 삭제했어요');
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)');
            } catch (err: any) {
              showAlert('오류', err.response?.data?.error || '정모 삭제에 실패했어요');
            }
          },
          '삭제', '취소', 'danger',
        );
      },
      '삭제', '취소', 'danger',
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

  // ─── 운영자: 참가자 레슨 중 토글 ───
  // 레슨 시작 → 자동추천/미편성 풀에서 빠지고 '레슨자' 박스로. 레슨 종료 → 로테이션
  // 복귀. 서버가 players:updated 를 emit 하므로 모든 운영판이 동기화된다.
  const handleToggleLesson = useCallback(
    async (targetUserId: string, targetName: string, makeLesson: boolean) => {
      if (!clubSessionId) return;
      try {
        await clubSessionApi.setPlayerLesson(clubSessionId, targetUserId, makeLesson);
        setMatchupTarget(null);
        loadPool();
        loadBoard();
        showSuccess(makeLesson ? `${targetName}님 레슨 시작` : `${targetName}님 레슨 종료`);
      } catch (err: any) {
        showAlert('오류', err?.response?.data?.error || '레슨 상태 변경에 실패했어요');
      }
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

  // ─── 대기 게임에서 이 자리 선수 빼기(제거) ───
  // 교체가 아니라 그 슬롯의 선수를 빼서 인원을 줄인다(예: 4→3). 남는 인원이 0이면
  // 빈 게임이 되므로 카드를 통째 삭제. updateEntry/deleteEntry 둘 다 소켓을 emit하므로
  // 양쪽 모드·다른 운영판이 자동 갱신된다.
  const handleRemoveFromGame = useCallback(async () => {
    if (!swapTarget) return;
    const entry = queuedEntries.find((e) => e.id === swapTarget.entryId);
    if (!entry) { setSwapTarget(null); return; }
    const nextIds = entry.playerIds.filter((_, i) => i !== swapTarget.slotIndex);
    try {
      if (nextIds.length === 0) {
        await deleteEntry(entry.id);
      } else {
        await updateEntry(entry.id, nextIds);
      }
      setSwapTarget(null);
      loadBoard();
      showSuccess(nextIds.length === 0 ? '게임 삭제됨' : '제거 완료!');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '제거 실패');
    }
  }, [swapTarget, queuedEntries, updateEntry, deleteEntry, loadBoard]);

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
    const hit = hitTestDrop(pageX, pageY, ['tray', 'queue', 'court', 'frame', 'pool']);
    if (!hit) return;
    if (hit.kind === 'tray') {
      placeStagedAt(userId, hit.slotIndex);
    } else if (hit.kind === 'queue' && hit.entryId) {
      handleDropOnQueueSlot(hit.entryId, hit.slotIndex, userId);
    } else if (hit.kind === 'court' && hit.courtId) {
      // 코트로 드롭: 선택된 그룹(staged)을 그 코트 draft 로. 선택이 없으면 끌어온 한 명만.
      draftCourt(hit.courtId, staged.length > 0 ? staged : [userId]);
    } else if (hit.kind === 'frame') {
      // 모드2: 끌어온 선수를 이 게임으로. 드롭한 가로 위치로 슬롯(0~3)을 추정해 '그 자리' 사람을 밀어냄.
      const slot = hit.rect.w > 0 ? Math.max(0, Math.min(3, Math.floor((pageX - hit.rect.x) / (hit.rect.w / 4)))) : undefined;
      moveToGame(userId, hit.entryId ?? null, slot);
    } else if (hit.kind === 'pool') {
      // 모드2: 끌어온 선수를 대기로(게임에서 빼기).
      moveToPool(userId);
    }
  }, [hitTestDrop, placeStagedAt, handleDropOnQueueSlot, draftCourt, staged, moveToGame, moveToPool]);
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

  // 테스트/데모용: 랜덤 샘플 게스트 N명을 만들어 정모에 즉시 체크인. 실제 출석이
  // 아니라 빠른 테스트용이며, 정모 종료 시 일반 게스트처럼 사라진다. (Hook must
  // live above the permission early-returns below — Rules of Hooks.)
  const handleAddTestGuests = useCallback(
    async (count: number) => {
      if (!clubSessionId || addingTestGuests) return;
      setAddingTestGuests(true);
      try {
        const { data } = await clubSessionApi.addRandomGuests(clubSessionId, count);
        showSuccess(`테스트 게스트 ${data?.createdCount ?? count}명 추가됨`);
        loadPool();
      } catch (err: any) {
        showAlert('오류', err?.response?.data?.error || '테스트 게스트 추가 실패');
      } finally {
        setAddingTestGuests(false);
      }
    },
    [clubSessionId, addingTestGuests, loadPool],
  );

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

  // Game-type TAG (남복/여복/혼복) for the 다음 게임 queue cards — a small tinted
  // PILL (type color text on a soft type-tinted bg) so the game composition is
  // obvious at a glance while scanning the queue. Same getGameType source as
  // GameTypeLabel; hidden for neutral/incomplete games (no misleading tag).
  const QueueTypeTag = ({ playerIds }: { playerIds: string[] }) => {
    const genders = [0, 1, 2, 3].map((i) => getPlayer(playerIds[i])?.gender);
    const t = getGameType(genders);
    if (t.type === 'neutral') return null;
    return (
      <View style={[styles.queueTypeTag, { backgroundColor: colors[t.bgKey] }]}>
        <Text style={[styles.queueTypeTagText, { color: colors[t.colorKey] }]}>{t.label}</Text>
      </View>
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
            {g && <GenderMarker meta={g} size={15} />}
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
    // 카드 색 = 성별(남=파랑/여=연노랑) — 모드2와 동일. 급수는 좌측 배지로.
    const chipStyle = [
      styles.gameChip,
      g
        ? { borderColor: g.gender === 'M' ? '#2563EB' : '#CA8A04', backgroundColor: g.gender === 'M' ? '#EFF6FF' : '#FEFCE8' }
        : { borderColor: colors.border, backgroundColor: colors.surface },
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
  const PoolCard = ({ m, stageable, statusBadge, selectToDrag }: { m: Player; stageable: boolean; statusBadge?: React.ReactNode; selectToDrag?: boolean }) => {
    const isStaged = stagedSet.has(m.userId);
    // Any checked-in player can be composed into the next game regardless of
    // state — 미편성/대기, 휴식(RESTING), 대기 편성됨, 게임 중 모두 편성 가능.
    // (중복은 빨간 점만, 막지 않음 — 운영자가 판단.)
    const canTap = stageable;
    // 모드 2(selectToDrag): '선택된'(isStaged) 카드만 드래그 가능 — 먼저 탭해 선택한
    // 뒤에야 끌 수 있어 오작동을 막는다. 모드 1은 종전대로 stageable 카드 전부 드래그.
    const draggable = stageable && (!selectToDrag || isStaged);
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
          const hit = hitTestDrop(pageX, pageY, ['tray', 'queue', 'court']);
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
        onPress={() => setMatchupTarget({ userId: m.userId, name: m.userName, skillLevel: m.skillLevel, isGuest: m.isGuest })}
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
        <View style={[styles.poolCell, poolCellStyle]}>
          <PlayerCard
            player={m}
            onPress={tap}
            stagedIndex={isStaged ? staged.indexOf(m.userId) + 1 : null}
            highlighted={isStaged}
            dimmed={!stageable && !isStaged}
            busy={busy}
          />
          {infoButton}
          {statusBadge && <View style={styles.allPoolBadgeOverlay} pointerEvents="none">{statusBadge}</View>}
        </View>
      );
    }

    return (
      <View style={[styles.poolCell, poolCellStyle]} {...pan.panHandlers} {...(Platform.OS === 'web' ? { onPointerDown: onPointerDownWeb } : {})}>
        <PlayerCard
          player={m}
          onPress={tap}
          stagedIndex={isStaged ? staged.indexOf(m.userId) + 1 : null}
          highlighted={isStaged}
          busy={busy}
        />
        {infoButton}
        {statusBadge && <View style={styles.allPoolBadgeOverlay} pointerEvents="none">{statusBadge}</View>}
      </View>
    );
  };

  // A labeled pool box (게임 중 / 대기 편성됨 / 미편성). 선수 검색이 있으면 이름
  // 부분일치(대소문자 무시)로 표시 카드를 거른다. count(헤더의 N명)는 항상 전체
  // 그룹 인원을 보여주고, 검색 중에는 보이는 카드 수를 함께 표시한다.
  const PoolBox = ({
    label, count, list, tint, stageable, emptyText,
  }: {
    label: string; count: number; list: Player[]; tint: string; stageable: boolean; emptyText: string;
  }) => {
    const shown = filtersActive ? list.filter(matchesPoolFilters) : list;
    return (
      <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.poolBoxHeader}>
          <View style={[styles.poolBoxDot, { backgroundColor: tint }]} />
          <Text style={[styles.poolBoxLabel, { color: colors.text }]}>{label}</Text>
          <View style={[styles.poolBoxCount, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.poolBoxCountText, { color: colors.textSecondary }]}>
              {filtersActive ? `${shown.length}/${count}` : `${count}명`}
            </Text>
          </View>
        </View>
        {shown.length === 0 ? (
          <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>
            {filtersActive ? '조건에 맞는 회원 없음' : emptyText}
          </Text>
        ) : (
          <View style={styles.poolGrid} onLayout={onPoolAreaLayout}>
            {shown.map((m) => <PoolCard key={m.userId} m={m} stageable={stageable} />)}
          </View>
        )}
      </View>
    );
  };

  // ─── 편성 상태 배지(전체 보기 전용) ───
  // 풀 상태 → 라벨 + 색. 3분할 박스의 점 색과 같은 매핑으로 통일:
  //   미편성(free)     = 초록(playerAvailable / secondary)
  //   편성됨(queued)   = 보라(info)
  //   게임 중(playing) = 빨강/주황(playerInTurn)
  const poolStatusMeta = (s: 'free' | 'queued' | 'playing') => {
    if (s === 'playing') return { label: '게임 중', fg: colors.playerInTurn, bg: colors.dangerBg };
    if (s === 'queued') return { label: '편성됨', fg: colors.info, bg: colors.infoBg };
    return { label: '미편성', fg: colors.secondary, bg: colors.secondaryBg };
  };
  const StatusBadge = ({ s }: { s: 'free' | 'queued' | 'playing' }) => {
    const meta = poolStatusMeta(s);
    return (
      <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
        <Text style={[styles.statusBadgeText, { color: meta.fg }]}>{meta.label}</Text>
      </View>
    );
  };

  // 전체 보기의 한 카드 = PoolCard(급수 avatar + 이름 + 성별 마커) + 편성 상태 배지.
  // 미편성(free)만 stageable — 탭하면 toggleStaged 로 다음 게임에 편성(3분할의
  // 미편성 박스와 동일). 전체 탭에서도 3분할과 똑같이 미편성/편성됨/게임중 '모두'
  // 편성 가능(stageable) — 이미 편성됐거나 게임 중인 사람도 '미리 다음 게임'에 넣을 수
  // 있어야 하니까(소프트 중복 = 빨간 점만, 막지 않음). 상태는 배지로 표시한다. 배지는
  // PoolCard 셀 내부 오버레이로 그려 그리드 폭(poolCellStyle) 측정/컬럼 계산을 유지한다.
  const AllPoolCard = ({ player, poolStatus }: { player: Player; poolStatus: 'free' | 'queued' | 'playing' }) => (
    <PoolCard m={player} stageable statusBadge={<StatusBadge s={poolStatus} />} />
  );

  // 전체 보기 컨테이너 — PoolBox 와 같은 외형의 단일 박스. 검색은 3분할과 동일한
  // poolSearch 로 거르고, 헤더 카운트는 검색 중엔 shown/total, 아니면 total 을
  // 보여준다. onPoolAreaLayout 으로 그리드 폭을 측정해 컬럼 수를 동일하게 맞춘다.
  const AllPoolBox = () => {
    const shown = filtersActive ? allPool.filter(({ player }) => matchesPoolFilters(player)) : allPool;
    return (
      <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.poolBoxHeader}>
          <Text style={[styles.poolBoxLabel, { color: colors.text }]}>전체 출석</Text>
          <View style={[styles.poolBoxCount, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.poolBoxCountText, { color: colors.textSecondary }]}>
              {filtersActive ? `${shown.length}/${allPool.length}` : `${allPool.length}명`}
            </Text>
          </View>
        </View>
        {shown.length === 0 ? (
          <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>
            {filtersActive ? '조건에 맞는 회원 없음' : '출석한 회원이 없어요'}
          </Text>
        ) : (
          <View style={styles.poolGrid} onLayout={onPoolAreaLayout}>
            {shown.map(({ player, poolStatus }) => (
              <AllPoolCard key={player.userId} player={player} poolStatus={poolStatus} />
            ))}
          </View>
        )}
      </View>
    );
  };

  // ─── 방금 나온(recent) 보기 ───
  // NOTE: 이 아래 보조 렌더러들은 위 권한 early-return 뒤에 정의되므로 절대 훅을
  // 호출하면 안 된다(Rules of Hooks). 모두 평범한 함수/컴포넌트로 둔다.
  //
  // at(종료 시각) → "방금" / "N분 전" / "N시간 전" 상대 시간. nowTs(30초 틱)에
  // 맞춰 다시 계산돼 시간이 자연스럽게 흘러간다.
  const relativeTime = (at: number) => {
    const diff = Math.max(0, nowTs - at);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}시간 전`;
  };

  // 한 사람의 현재 풀 상태(게임 중 / 편성됨 / 미편성) — 방금 나온 칩에서 누가
  // 아직 자유로운지(다시 편성 가능) 살짝 보여주기 위해 쓴다. 풀에서 빠졌으면 null.
  const recentPlayerStatus = (pid: string): 'free' | 'queued' | 'playing' | null => {
    const p = getPlayer(pid);
    if (!p) return null;
    if (p.status === 'IN_TURN') return 'playing';
    if (queuedPlayerIds.has(pid)) return 'queued';
    return 'free';
  };

  // 방금 나온 한 묶음의 선수 칩. 급수 avatar(letter) + 이름 + 성별 마커.
  // 탭하면 toggleStaged(그 한 명만 골라 트레이에 추가/제거 — 다른 묶음과 섞기).
  // 이미 트레이에 있으면 primary 로 강조. 현재 게임 중/편성됨이면 작은 dim 태그를
  // 덧붙여 운영자가 누가 아직 자유로운지 한눈에 본다. 풀에서 빠진 사람은 저장된
  // 이름으로 폴백 표시하되 탭 불가(편성할 대상이 없음).
  const RecentChip = ({ pid, fallbackName }: { pid: string; fallbackName?: string }) => {
    const p = getPlayer(pid);
    const skill = getSkillMeta(p?.skillLevel);
    const g = getGenderMeta(p?.gender);
    const display = p?.userName || fallbackName;
    const isStaged = stagedSet.has(pid);
    const st = recentPlayerStatus(pid);
    const gone = !p; // 풀에서 빠짐 → 편성 불가
    const busy = busySet.has(pid);
    const body = (
      <>
        <View style={[styles.recentChipSkill, { borderColor: skill.color, backgroundColor: colors.surface }]}>
          <Text style={[styles.recentChipSkillText, { color: skill.color }]}>
            {(p?.skillLevel || '·').toUpperCase()}
          </Text>
        </View>
        <Text
          style={[styles.recentChipName, { color: isStaged ? colors.primary : gone ? colors.textLight : colors.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {display || '?'}
        </Text>
        {g && <GenderMarker meta={g} size={13} />}
        {/* 현재 상태가 게임 중/편성됨이면 작은 dim 태그. 미편성(free)이면 깔끔하게
            아무 것도 안 붙여 "자유로운 사람"이 시각적으로 도드라지게. */}
        {st === 'playing' && (
          <View style={[styles.recentStatusTag, { backgroundColor: colors.dangerBg }]}>
            <Text style={[styles.recentStatusTagText, { color: colors.playerInTurn }]}>게임 중</Text>
          </View>
        )}
        {st === 'queued' && (
          <View style={[styles.recentStatusTag, { backgroundColor: colors.infoBg }]}>
            <Text style={[styles.recentStatusTagText, { color: colors.info }]}>편성됨</Text>
          </View>
        )}
        {gone && (
          <View style={[styles.recentStatusTag, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.recentStatusTagText, { color: colors.textLight }]}>퇴장</Text>
          </View>
        )}
        {busy && !gone && <View style={[styles.conflictDot, { borderColor: colors.surface }]} />}
      </>
    );
    const chipStyle = [
      styles.recentChip,
      {
        borderColor: isStaged ? colors.primary : colors.border,
        backgroundColor: isStaged ? colors.primaryLight : colors.surface,
      },
    ];
    if (gone) {
      // 풀에 없는 사람 → 표시만, 탭 불가.
      return <View style={[chipStyle, { opacity: 0.7 }]}>{body}</View>;
    }
    return (
      <TouchableOpacity
        style={chipStyle}
        onPress={() => toggleStaged(pid)}
        activeOpacity={0.7}
        accessibilityLabel={`${display || ''} ${isStaged ? '편성 해제' : '다음 게임에 추가'}`}
      >
        {body}
      </TouchableOpacity>
    );
  };

  // 방금 나온 한 묶음 카드 = 함께 친 4명 한 게임. 헤더(상대 시간) + 4개 칩 +
  // "이 4명 편성" 버튼. 버튼은 setStaged 로 4명(클램프)을 통째로 트레이에 올린다
  // (풀에 남아 있는 사람만; 퇴장자는 제외). 칩 각각은 개별 탭으로 섞어 고를 수 있다.
  const RecentGroupCard = ({ item }: { item: RecentOut }) => {
    // 편성 가능한(아직 풀에 있는) id 만 → "이 4명 편성" 대상. 전원 퇴장이면 비활성.
    const stageableIds = item.playerIds.filter((pid) => getPlayer(pid));
    const canStageGroup = stageableIds.length >= 2;
    return (
      <View style={[styles.recentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.recentCardHeader}>
          <View style={[styles.recentTimeDot, { backgroundColor: colors.playerInTurn }]} />
          <Text style={[styles.recentTime, { color: colors.text }]}>{relativeTime(item.at)}</Text>
          <Text style={[styles.recentSub, { color: colors.textLight }]}>· 끝난 게임</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[
              styles.recentStageBtn,
              { backgroundColor: canStageGroup ? colors.primary : colors.textLight },
            ]}
            onPress={() => prefillStaged(stageableIds)}
            disabled={!canStageGroup}
            activeOpacity={0.85}
            accessibilityLabel="이 4명 편성"
          >
            <Text style={styles.recentStageBtnText}>이 {stageableIds.length}명 편성</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.recentChipGrid}>
          {item.playerIds.map((pid, i) => (
            <RecentChip key={`${pid}-${i}`} pid={pid} fallbackName={item.names[pid]} />
          ))}
        </View>
      </View>
    );
  };

  // 방금 나온 컨테이너 — 누적 목록을 최신순으로 카드로 쌓는다. 비어 있으면 안내.
  // 그룹 단위 보기라 가나다 평면 목록이 아니다(검색 미사용 — 깔끔하게 유지).
  const RecentOutBox = () => (
    <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.poolBoxHeader}>
        <View style={[styles.poolBoxDot, { backgroundColor: colors.playerInTurn }]} />
        <Text style={[styles.poolBoxLabel, { color: colors.text }]}>방금 나온</Text>
        <View style={[styles.poolBoxCount, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.poolBoxCountText, { color: colors.textSecondary }]}>
            {recentlyOut.length}게임
          </Text>
        </View>
      </View>
      {recentlyOut.length === 0 ? (
        <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>
          아직 끝난 게임이 없어요 — 게임을 종료하면 여기 쌓여요
        </Text>
      ) : (
        <View style={styles.recentList}>
          {recentlyOut.map((item) => (
            <RecentGroupCard key={item.id} item={item} />
          ))}
        </View>
      )}
    </View>
  );

  // ─── 풀 보기 전환 탭(그룹별 | 전체) ───
  // 컴팩트 세그먼트 컨트롤 — 보드의 깔끔한 톤에 맞춘 분절 토글. 좌측 패널(태블릿/
  // 데스크톱) 또는 풀 위(폰)에 위치. 선택된 탭만 surface + primary 텍스트로 강조.
  const PoolTabs = (
    <View style={[styles.poolTabs, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      {/* 3 세그먼트 — 폰 390 폭에서도 넘치지 않게 라벨을 짧게(그룹/전체/방금 나온). */}
      {([['group', '그룹'], ['all', '전체'], ['recent', '방금 나온']] as const).map(([key, label]) => {
        const active = poolTab === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.poolTab, active && [styles.poolTabActive, { backgroundColor: colors.surface }]]}
            onPress={() => setPoolTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label} 보기`}
          >
            <Text style={[styles.poolTabText, { color: active ? colors.primary : colors.textSecondary }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // 선수 검색 입력 — 출석 인원 섹션 맨 위(풀 위)에 들어가는 슬림한 한 줄 입력.
  // WEB-SAFE(네이티브 전용 prop 없음). 검색어는 trim+소문자로 정규화해 저장하고,
  // ✕ 로 즉시 비울 수 있다.
  // 게임수 구간 칩 정의(단일 선택). 0 / 1–2 / 3+ 로 적게 친 사람을 빠르게 추려낸다.
  const GAMES_FILTERS: { key: 'all' | '0' | '1-2' | '3+'; label: string }[] = [
    { key: 'all', label: '전체' }, { key: '0', label: '0게임' },
    { key: '1-2', label: '1–2' }, { key: '3+', label: '3+' },
  ];
  const PoolSearch = (
    <View style={styles.poolSearchWrap}>
      <View style={[styles.poolSearchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="search" size={15} color={colors.textLight} />
        <TextInput
          style={[styles.poolSearchInput, { color: colors.text }]}
          value={poolSearch}
          onChangeText={(t) => setPoolSearch(t.trim().toLowerCase())}
          placeholder="선수 검색"
          placeholderTextColor={colors.textLight}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="선수 검색"
        />
        {poolSearch.length > 0 && (
          <TouchableOpacity
            onPress={() => setPoolSearch('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="검색어 지우기"
          >
            <Icon name="close" size={15} color={colors.textLight} />
          </TouchableOpacity>
        )}
        {/* 필터 토글 — 활성 속성 필터 개수를 배지로. 탭하면 아래 칩 패널이 열린다. */}
        <TouchableOpacity
          style={[
            styles.poolFilterToggle,
            { borderColor: colors.border },
            (filterOpen || activeFilterCount > 0) && { backgroundColor: colors.primaryBg, borderColor: colors.primary },
          ]}
          onPress={() => setFilterOpen((v) => !v)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="필터"
          accessibilityState={{ expanded: filterOpen }}
        >
          <Icon name="tools" size={14} color={activeFilterCount > 0 ? colors.primary : colors.textSecondary} />
          {activeFilterCount > 0 && (
            <View style={[styles.poolFilterBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.poolFilterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {filterOpen && (
        <View style={[styles.poolFilterPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* 급수 (다중) — 선택 시 해당 급수색으로 채워 한눈에. 'none'=미설정. */}
          <View style={styles.poolFilterRow}>
            <Text style={[styles.poolFilterRowLabel, { color: colors.textSecondary }]}>급수</Text>
            <View style={styles.poolFilterChips}>
              {SKILL_LEVELS.map((lv) => {
                const on = filterSkills.has(lv);
                const meta = getSkillMeta(lv);
                return (
                  <TouchableOpacity
                    key={lv}
                    style={[styles.filterChip, { borderColor: colors.border }, on && { backgroundColor: meta.color, borderColor: meta.color }]}
                    onPress={() => toggleFilterSkill(lv)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`급수 ${lv}`}
                  >
                    <Text style={[styles.filterChipText, { color: on ? '#fff' : colors.text }]}>{lv}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.filterChip, { borderColor: colors.border }, filterSkills.has('none') && { backgroundColor: colors.textLight, borderColor: colors.textLight }]}
                onPress={() => toggleFilterSkill('none')}
                accessibilityRole="button"
                accessibilityState={{ selected: filterSkills.has('none') }}
                accessibilityLabel="급수 미설정"
              >
                <Text style={[styles.filterChipText, { color: filterSkills.has('none') ? '#fff' : colors.textSecondary }]}>미설정</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* 성별 (다중) */}
          <View style={styles.poolFilterRow}>
            <Text style={[styles.poolFilterRowLabel, { color: colors.textSecondary }]}>성별</Text>
            <View style={styles.poolFilterChips}>
              {(['M', 'F'] as const).map((g) => {
                const on = filterGenders.has(g);
                const gm = GENDER_META[g];
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.filterChip, { borderColor: colors.border }, on && { backgroundColor: gm.color, borderColor: gm.color }]}
                    onPress={() => toggleFilterGender(g)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`성별 ${gm.label}`}
                  >
                    <Text style={[styles.filterChipText, { color: on ? '#fff' : colors.text }]}>{gm.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {/* 게임수 (단일) */}
          <View style={styles.poolFilterRow}>
            <Text style={[styles.poolFilterRowLabel, { color: colors.textSecondary }]}>게임수</Text>
            <View style={styles.poolFilterChips}>
              {GAMES_FILTERS.map(({ key, label }) => {
                const on = filterGames === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterChip, { borderColor: colors.border }, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setFilterGames(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`게임수 ${label}`}
                  >
                    <Text style={[styles.filterChipText, { color: on ? '#fff' : colors.text }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.poolFilterClear} onPress={clearPoolFilters} accessibilityRole="button" accessibilityLabel="필터 초기화">
              <Icon name="close" size={13} color={colors.textSecondary} />
              <Text style={[styles.poolFilterClearText, { color: colors.textSecondary }]}>필터 초기화</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  // 풀 본문 — 탭에 따라 3분할(그룹별) 또는 전체 단일 목록을 보여준다. 탭 스위처
  // 자체는 위에 항상 떠 있고, 여기서 본문만 갈아끼운다.
  const PoolBoxes = (
    <>
      {PoolTabs}
      {poolTab === 'group' ? (
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
      ) : poolTab === 'all' ? (
        <AllPoolBox />
      ) : (
        <RecentOutBox />
      )}
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
        {g && <GenderMarker meta={g} size={14} />}
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
              <QueueTypeTag playerIds={entry.playerIds} />
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
          <QueueTypeTag playerIds={entry.playerIds} />
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

  // ── Per-court elapsed timer badge: "⏱ N분 진행 중" (or "방금" under 1 min). ──
  // Computed from now − startedAt and re-rendered by the 30s `nowTs` ticker.
  // Long games (≥ WARN_MIN) are tinted a warm color as a gentle nudge to rotate.
  // Renders nothing when there's no start time (so it never shows on empty courts).
  const ELAPSED_WARN_MIN = 20;
  const CourtElapsedBadge = ({ startedAt }: { startedAt?: string | null }) => {
    if (!startedAt) return null;
    const startMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startMs)) return null;
    const mins = Math.max(0, Math.floor((nowTs - startMs) / 60000));
    const warm = mins >= ELAPSED_WARN_MIN;
    const tint = warm ? colors.warning : colors.textSecondary;
    const bg = warm ? colors.warningLight : colors.surfaceSecondary;
    const label = mins < 1 ? '⏱ 방금 시작' : `⏱ ${mins}분 진행 중`;
    return (
      <View style={[styles.elapsedBadge, { backgroundColor: bg }]} accessibilityLabel={mins < 1 ? '방금 시작' : `${mins}분 진행 중`}>
        <Text style={[styles.elapsedBadgeText, { color: tint }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  };

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
      // 모드 2: 게임판에서 2명 이상 선택돼 있으면 빈 코트 탭으로 그 인원 바로 시작.
      const canPlaceSelected = boardMode === 2 && isEmpty && staged.length >= 2;
      const canAssign = isEmpty && (hasAssignable || canPlaceSelected);
      const affordance = isMaint
        ? '사용 불가'
        : canPlaceSelected
          ? '탭하여 선택 인원으로 시작'
          : canAssign
            ? '탭하여 다음 게임 배정'
            : queuedEntries.length > 0
              ? '배정 가능한 게임 없음'
              : '대기 게임 없음';
      const dotColor = isMaint ? colors.courtMaintenance : colors.courtEmpty;
      const Wrapper: any = canAssign ? TouchableOpacity : View;
      const onCourtPress = canPlaceSelected
        ? () => handlePlaceSelectedOnCourt(court.id)
        : () => handleAssignToCourt(court.id);
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
            ? { onPress: onCourtPress, activeOpacity: 0.8, accessibilityLabel: `${court.name} 배정` }
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
          {/* Live elapsed timer (N분 진행 중). Pushed to the right next to 게임 중. */}
          <CourtElapsedBadge startedAt={court.currentTurn?.startedAt} />
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

        {/* Quiet secondary action for a court the operator believes is stuck
            (shows 게임 중 but won't clear). Calls the same robust court-based
            endpoint with a clearer confirm, freeing the players so they can be
            reassigned. */}
        <TouchableOpacity
          style={styles.courtClearLink}
          onPress={() => handleEndGame(court.id, true)}
          activeOpacity={0.7}
          accessibilityLabel={`${court.name} 코트 비우기`}
        >
          <Text style={[styles.courtClearLinkText, { color: colors.textLight }]}>코트가 안 비워지나요? 코트 비우기</Text>
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
  // On tablet+ (wide inline header) bump the header pills to a comfortable
  // touch target; phones keep the compact narrow-header sizing untouched.
  const headerLinkTouch = narrowHeader ? null : styles.headerLinkTablet;

  const headerActions = (
    <>
      <TouchableOpacity
        style={[styles.headerLink, headerLinkTouch, { borderColor: colors.border }]}
        onPress={() => setCourtModal(true)}
        activeOpacity={0.8}
      >
        <Icon name="court" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>코트 관리</Text>
      </TouchableOpacity>
      {!!clubId && (
        <TouchableOpacity
          style={[styles.headerLink, headerLinkTouch, { borderColor: colors.border }]}
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
        style={[styles.headerLink, headerLinkTouch, { borderColor: colors.border }]}
        onPress={() => router.push(`/session/${clubSessionId}/board`)}
        activeOpacity={0.8}
      >
        <Icon name="tv" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>현황 보드</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerLink, headerLinkTouch, { borderColor: colors.border }]}
        onPress={() => router.push(`/session/${clubSessionId}/qr`)}
        activeOpacity={0.8}
        accessibilityLabel="출석 QR"
      >
        <Icon name="qr" size={16} color={colors.primary} />
        <Text style={[styles.headerLinkText, { color: colors.primary }]}>출석 QR</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerLink, headerLinkTouch, { borderColor: colors.border }]}
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
        style={[styles.headerLink, headerLinkTouch, { borderColor: colors.danger, backgroundColor: colors.dangerBg }]}
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
    <View style={styles.poolActionsWrap}>
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

      {/* 테스트/데모용 랜덤 게스트 — 실제 출석과 혼동하지 않도록 별도 줄 + 라벨 */}
      <View style={[styles.testGuestRow, { borderColor: colors.border }]}>
        <Text style={[styles.testGuestLabel, { color: colors.textSecondary }]} numberOfLines={1}>
          🧪 테스트 게스트
        </Text>
        {[5, 10, 20].map((n) => (
          <TouchableOpacity
            key={n}
            style={[
              styles.testGuestBtn,
              { borderColor: colors.border, backgroundColor: colors.surface },
              addingTestGuests && { opacity: 0.5 },
            ]}
            onPress={() => handleAddTestGuests(n)}
            disabled={addingTestGuests}
            activeOpacity={0.8}
            accessibilityLabel={`테스트 게스트 ${n}명 추가`}
          >
            <Text style={[styles.testGuestBtnText, { color: colors.textSecondary }]}>
              {addingTestGuests ? '...' : `+${n}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
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
          canRemove={swapTarget.slotIndex < (queuedEntries.find((e) => e.id === swapTarget.entryId)?.playerIds.length ?? 0)}
          onRemove={handleRemoveFromGame}
        />
      )}
      {runningSwap && (
        <SwapPlayerModal
          colors={colors}
          freePool={freePool}
          queuedPool={queuedPool}
          currentIds={runningSwap.currentIds}
          onPick={handleReplaceRunning}
          onClose={() => setRunningSwap(null)}
          allowAddToEmpty={false}
        />
      )}
      {matchupTarget && clubSessionId && (
        <MatchupModal
          colors={colors}
          clubSessionId={clubSessionId}
          userId={matchupTarget.userId}
          name={matchupTarget.name}
          skillLevel={matchupTarget.skillLevel ?? null}
          isGuest={!!matchupTarget.isGuest}
          isInLesson={!!getPlayer(matchupTarget.userId)?.isInLesson}
          onToggleLesson={() => handleToggleLesson(matchupTarget.userId, matchupTarget.name, !getPlayer(matchupTarget.userId)?.isInLesson)}
          onCheckout={() => handleOperatorCheckout(matchupTarget.userId, matchupTarget.name)}
          onSaved={(updatedName) => {
            // Keep the open modal's header/edit form in sync, then refresh pool.
            setMatchupTarget((t) => (t ? { ...t, name: updatedName } : t));
            loadPool();
          }}
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
          <QueueTypeTag playerIds={queueDragEntry.playerIds} />
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

  // ─── 운영판 모드 전환 탭(모드 1 | 모드 2) ───
  // 헤더 바로 아래 공통 위치. 풀 보기 탭과 같은 세그먼트 스타일을 재사용한다.
  const ModeTabs = (
    <View style={[styles.modeTabsRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.modeTabsLabel, { color: colors.textSecondary }]}>운영 모드</Text>
      <View style={[styles.modeTabs, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        {([[1, '기본'], [2, '게임판']] as const).map(([key, label]) => {
          const active = boardMode === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.modeTab, active && { backgroundColor: colors.primary }]}
              onPress={() => setBoardMode(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`모드 ${key}로 전환`}
            >
              <Text style={[styles.modeTabText, { color: active ? '#fff' : colors.textSecondary }]}>
                모드 {key} · {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // 2분할 크기 조절 막대 — leftPane↔rightPane 사이. 드래그로 왼쪽 폭 조정(웹: col-resize).
  const SplitDivider = (
    <View
      {...dividerPan.panHandlers}
      style={styles.splitDivider}
      accessibilityRole="adjustable"
      accessibilityLabel="분할 크기 조절"
    >
      <View style={[styles.splitDividerHandle, { backgroundColor: colors.border }]} />
    </View>
  );

  // ─── 모드 2 (게임판) 구성 요소 ───
  // 게임판: 출석 전원을 태그 그리드로(필터 predicate 공유). Phase 2는 표시 전용
  // (stageable=false → 탭/드래그 없음). 코트/커스텀/레슨자는 기존 컴포넌트 재사용.
  const Mode2GamePanel = (
    <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.poolGrid} onLayout={onPoolAreaLayout}>
        {gamePanelPlayers.filter(matchesPoolFilters).map((m) => (
          <PoolCard key={m.userId} m={m} stageable selectToDrag />
        ))}
      </View>
      {gamePanelPlayers.length === 0 && (
        <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>게임판에 올릴 회원이 없어요</Text>
      )}
      {gamePanelPlayers.length > 0 && gamePanelPlayers.filter(matchesPoolFilters).length === 0 && (
        <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>조건에 맞는 회원 없음</Text>
      )}
    </View>
  );
  // 레슨자 박스 — 레슨 중(비-게임) 인원. 수동으로만 코트에 내릴 수 있게 선택 가능
  // (탭=선택 → 빈 코트 탭/편성). 자동추천·미편성 풀에는 잡히지 않는다.
  const Mode2LessonBox = (
    <View style={[styles.poolBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {lessonPool.length === 0 ? (
        <Text style={[styles.poolBoxEmpty, { color: colors.textLight }]}>레슨 중인 회원이 없어요</Text>
      ) : (
        <View style={styles.poolGrid}>
          {lessonPool.map((m) => <PoolCard key={m.userId} m={m} stageable selectToDrag />)}
        </View>
      )}
    </View>
  );
  // 모드 2 코트 = 드롭존 박스. 비어 있으면 '코트' 드롭타깃으로 등록(게임판에서 고른
  // 그룹을 끌어다 놓거나 탭해서 올림) → draft 표시 + "게임 시작". 게임 중/점검은 기존
  // CourtCard 를 그대로 재사용(2×2 + 게임 종료).
  const Mode2CourtBox = ({ court }: { court: Court }) => {
    const ref = useRef<View>(null);
    const dropId = `court-${court.id}`;
    const playingEntry = playingByCourtId.get(court.id);
    const isMaint = court.status === 'MAINTENANCE';
    const isEmpty = !isMaint && court.status === 'EMPTY' && !playingEntry;
    const draft = courtDrafts[court.id] || [];
    const isHover = hoverDropId === dropId;
    const courtWidth = courtCardWidth ? { width: courtCardWidth } : null;

    const measure = useCallback(() => {
      if (!isEmpty) { unregisterDrop(dropId); return; }
      ref.current?.measureInWindow((x, y, w, h) => {
        registerDrop({ id: dropId, kind: 'court', courtId: court.id, slotIndex: 0, rect: { x, y, w, h } });
      });
    }, [dropId, isEmpty, court.id]);
    useEffect(() => {
      if (!isEmpty) { unregisterDrop(dropId); return; }
      const t = setTimeout(measure, 0);
      return () => { clearTimeout(t); unregisterDrop(dropId); };
    });

    if (!isEmpty) return <CourtCard court={court} />;

    const hasDraft = draft.length > 0;
    const canStart = draft.length >= 2;
    return (
      <View
        ref={ref}
        onLayout={measure}
        collapsable={false}
        style={[
          styles.mode2CourtBox,
          courtWidth,
          {
            backgroundColor: isHover ? colors.primaryBg : colors.surface,
            borderColor: isHover ? colors.primary : hasDraft ? colors.info : colors.border,
            borderStyle: hasDraft || isHover ? 'solid' : 'dashed',
          },
        ]}
      >
        <View style={styles.mode2CourtHeader}>
          <View style={[styles.courtStateDot, { backgroundColor: colors.courtEmpty }]} />
          <Text style={[styles.courtCardName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.mode2CourtMeta, { color: hasDraft ? colors.info : colors.textLight }]}>
            {hasDraft ? `편성 중 ${draft.length}/4` : '비어있음'}
          </Text>
        </View>

        {hasDraft ? (
          <>
            <View style={styles.gameGrid}>
              {[0, 1, 2, 3].map((i) => {
                const pId = draft[i];
                const p = pId ? getPlayer(pId) : null;
                if (!pId) {
                  return (
                    <View key={i} style={styles.gameGridCell}>
                      <View style={[styles.mode2DraftEmpty, { borderColor: colors.border }]}>
                        <Text style={[styles.mode2DraftEmptyText, { color: colors.textLight }]}>＋</Text>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={i} style={styles.gameGridCell}>
                    <GamePlayerChip
                      pId={pId}
                      name={p?.userName}
                      busy={busySet.has(pId)}
                      onPress={() => removeFromCourtDraft(court.id, i)}
                      accessibilityLabel={`${p?.userName || ''} 빼기`}
                    />
                  </View>
                );
              })}
            </View>
            <Text style={[styles.mode2CourtHint, { color: colors.textLight }]}>선수 탭=빼기 · 게임판에서 더 끌어올 수 있어요</Text>
            <View style={styles.mode2CourtActions}>
              <TouchableOpacity
                style={[styles.mode2StartBtn, { backgroundColor: canStart ? colors.primary : colors.textLight }]}
                onPress={() => startCourtDraft(court.id)}
                disabled={!canStart}
                activeOpacity={0.85}
                accessibilityLabel={`${court.name} 게임 시작`}
              >
                <Icon name="play" size={15} color="#fff" />
                <Text style={styles.mode2StartBtnText}>게임 시작{draft.length < 4 ? ` (${draft.length}/4)` : ''}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.clearBtn, { borderColor: colors.border }]} onPress={() => clearCourtDraft(court.id)}>
                <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>비우기</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            activeOpacity={staged.length > 0 ? 0.7 : 1}
            onPress={() => { if (staged.length > 0) draftCourt(court.id, staged); }}
            style={styles.mode2CourtEmptyInner}
            accessibilityLabel={staged.length > 0 ? `${court.name}에 선택 인원 올리기` : `${court.name} 비어있음`}
          >
            <Text style={[styles.mode2CourtEmptyText, { color: colors.textLight }]} numberOfLines={2}>
              {staged.length > 0 ? `탭하면 선택한 ${staged.length}명을 여기 올려요` : '게임판에서 고른 인원을\n여기로 드래그'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };
  const Mode2Courts = (
    <View style={styles.courtGrid} onLayout={onCourtAreaLayout}>
      {courts.map((court) => <Mode2CourtBox key={court.id} court={court} />)}
      {courts.length === 0 && (
        <Text style={[styles.emptyPool, { color: colors.textLight }]}>코트가 없어요. "코트 관리"에서 추가하세요</Text>
      )}
    </View>
  );
  const Mode2RightColumn = (
    <>
      <Text style={[styles.colHeader, { color: colors.textSecondary }]}>코트</Text>
      {Mode2Courts}
      <Text style={[styles.colHeader, { color: colors.textSecondary, marginTop: spacing.md }]}>커스텀 (요구사항)</Text>
      {QueuePanel}
      <Text style={[styles.colHeader, { color: colors.textSecondary, marginTop: spacing.md }]}>레슨자</Text>
      {Mode2LessonBox}
    </>
  );
  // 모드 2 선택 바 — 게임판에서 고른 인원(staged) 요약 + 자동추천/큐추가/초기화.
  // 코트로 바로 내리는 건 빈 코트 탭(handlePlaceSelectedOnCourt), 큐 등록은 여기 버튼.
  // 트레이와 같은 버튼/추천칩 스타일을 재사용한다.
  const Mode2SelectBar = (
    <View style={[styles.mode2SelectBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.mode2SelectTop}>
        <Text style={[styles.mode2SelectCount, { color: colors.text }]}>선택 {staged.length}/4</Text>
        <Text style={[styles.mode2SelectHint, { color: colors.textLight }]} numberOfLines={1}>
          고른 인원을 코트로 드래그(또는 코트 탭) → 코트에서 "게임 시작"
        </Text>
      </View>
      {suggestNote && <Text style={[styles.suggestNote, { color: colors.warning }]}>{suggestNote}</Text>}
      <View style={styles.trayButtons}>
        <TouchableOpacity
          style={[styles.suggestBtn, { backgroundColor: suggestUnavailable ? colors.textLight : colors.info }]}
          onPress={() => { if (suggestUnavailable) return; setSuggestNote(null); setModeChooserOpen((o) => !o); }}
          disabled={suggesting || suggestUnavailable}
          activeOpacity={0.85}
          accessibilityLabel="자동 추천"
        >
          {suggesting
            ? <ActivityIndicator size="small" color={palette.white} />
            : <Text style={styles.suggestBtnText}>{suggestUnavailable ? '준비 중' : `🎲 자동 추천${modeChooserOpen ? ' ▴' : ' ▾'}`}</Text>}
        </TouchableOpacity>
        {staged.length > 0 && (
          <TouchableOpacity style={[styles.clearBtn, { borderColor: colors.border }]} onPress={clearStaged}>
            <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>초기화</Text>
          </TouchableOpacity>
        )}
      </View>
      {modeChooserOpen && !suggestUnavailable && (
        <View style={[styles.modeChooser, { borderColor: colors.border, backgroundColor: colors.background }]}>
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
                <Text style={[styles.modeChipLabel, { color: colors.text }]}>{m.emoji} {m.label}</Text>
                <Text style={[styles.modeChipHint, { color: colors.textSecondary }]} numberOfLines={1}>{m.hint}</Text>
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
        <Text style={styles.registerBtnText}>다음 게임 큐에 추가{staged.length > 0 && staged.length < 4 ? ` (${staged.length}/4)` : ''}</Text>
      </TouchableOpacity>
    </View>
  );

  // 넓은 화면=2열[게임판 | 코트·커스텀·레슨자], 좁으면 세로 스택. 기존 split/leftPane/
  // rightPane/stackedContent 스타일을 그대로 재사용한다.
  // ─── 모드 2 = 게임판(자동 편성 + 드래그 조정) ───
  // 풀(게임수 적은 순=친 사람 아래로)에서 4명씩 자동으로 번호 게임에 편성. 운영자는 선수를
  // 드래그해 다른 게임/대기로 옮겨 조정만. 꽉 찬 게임은 '코트 투입'으로 시작. override=강제배치.
  const gamesOf = (uid: string) => getPlayer(uid)?.gamesPlayedToday ?? 0;
  // 진행 중(코트 위) 선수 — 게임판엔 남겨 '다음 게임'을 미리 편성하되 맨 뒤 순번으로 민다.
  const playingSet = new Set<string>();
  playingByCourtId.forEach((e) => (e.playerIds || []).forEach((id) => playingSet.add(id)));
  // 큐에 든 사람(=다음 게임 편성됨). 서버 공유(모드1과 동일).
  const inQueue = new Set<string>();
  for (const e of queuedEntries) for (const id of e.playerIds) inQueue.add(id);
  // 게임 중(코트 위) 게임들 — 게임판에 4명 1줄로 표시(조합 파악 + 다음 게임 편성에 도움).
  const liveGames = courts.filter((c) => c.status !== 'EMPTY' || !!playingByCourtId.get(c.id));
  // 대기 풀 = 큐에도 없고 게임 중도 아닌 출석자. 검색/필터 + 게임수 적은 순(친 사람 아래).
  const poolQ = poolQuery.trim().toLowerCase();
  const pool = uniquePlayers
    .filter((m) => matchesPoolFilters(m) && !inQueue.has(m.userId) && !playingSet.has(m.userId)
      && (poolQ === '' || (m.userName || '').toLowerCase().includes(poolQ))
      && (poolGenders.length === 0 || poolGenders.includes(getGenderMeta(m.gender)?.gender ?? ''))
      && (poolSkills.length === 0 || poolSkills.includes((m.skillLevel || '').toUpperCase())))
    .sort((a, b) => gamesOf(a.userId) - gamesOf(b.userId) || a.userName.localeCompare(b.userName));
  const poolIds = pool.map((m) => m.userId);
  const poolSet = new Set(poolIds);
  const uniqueIdSet = new Set(uniquePlayers.map((m) => m.userId)); // 체크인된 전체(빈칸 유지 vs 제거 판단용)
  // 대기(게임 중 아님)는 '항상' 급수(S>A>B>C>D>E>F) → 이름순으로 정렬(일관). 게임판에서 대기로
  // 옮긴 사람도 곧장 제자리(급수순)에 들어간다. 안정 슬롯(빈칸 유지)은 정렬을 깨서 폐기.
  const skillRank = (lv?: string | null) => (({ S: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 } as Record<string, number>)[(lv || '').toUpperCase()] ?? 9);
  // 방금 끝난 게임 4명 묶음 — 정렬과 '별개로' 대기 명단 맨 아래에 그대로 한 줄로 쌓는다.
  // (최근에 끝난 게 맨 아래로 계속 쌓임. recentlyOut 은 최신이 앞 → reverse 로 오래된 게 위/최근이 아래.)
  // '원래 4자리'를 고정으로 둔다 — 게임에 빼낸 사람 자리는 빈칸(갭)으로 유지하고, 그 사람을 다시
  // 빼면(대기로) recentlyOut 에 그대로 있어 '그 자리'로 돌아온다. (한판도 안 친 사람은 위 급수 정렬로.)
  const finishedGroups: Array<{ slots: (string | null)[]; at: number }> = [];
  const finishedIds = new Set<string>();
  for (const r of [...recentlyOut].reverse()) {
    const slots = r.playerIds.slice(0, 4).map((id) => (poolSet.has(id) && !finishedIds.has(id)) ? id : null);
    if (slots.some((x) => x !== null)) {
      slots.forEach((id) => { if (id) finishedIds.add(id); });
      finishedGroups.push({ slots, at: r.at });
    }
  }
  // 위쪽: 아직 게임 안 친(또는 묶음에서 빠진) 사람 — 급수(S>A>...>F) → 이름순 정렬.
  const sortedPool = pool
    .filter((m) => !finishedIds.has(m.userId))
    .slice()
    .sort((a, b) => skillRank(a.skillLevel) - skillRank(b.skillLevel) || a.userName.localeCompare(b.userName))
    .map((m) => m.userId);
  const poolGroups: string[][] = [];
  for (let i = 0; i < sortedPool.length; i += 4) poolGroups.push(sortedPool.slice(i, i + 4));
  // 코트에 들어간(게임 중) 묶음 — 대기 맨 아래에 묶음으로 보여 '게임 치는 동안 다음 게임 미리 편성'.
  const playingCols = courts
    .map((c) => ({ name: c.name, entry: playingByCourtId.get(c.id) }))
    .filter((x) => x.entry && (x.entry.playerIds?.length ?? 0) > 0)
    .map((x) => ({ name: x.name, ids: x.entry!.playerIds as string[] }));
  // 번호 게임 = 서버 큐 순서 + 끝에 '새 게임' 칸(entryId null).
  const queueFrames: Array<{ id: string | null; players: string[] }> = [
    ...queuedEntries.map((e) => ({ id: e.id, players: e.playerIds })),
    { id: null, players: [] },
  ];
  // 게임판은 '항상 2분할(2열)' 유지 — 게임이 적어도 2열로 균형 있게(가독성). 컬럼당 = ceil(개수/2).
  // 4→2/2, 6→3/3, 10→5/5, 12→6/6, 14→7/7… (게임이 1개뿐이면 1열)
  const GAME_COL = Math.max(1, Math.ceil(queueFrames.length / 2));
  const gameColumns: Array<typeof queueFrames> = [];
  for (let i = 0; i < queueFrames.length; i += GAME_COL) gameColumns.push(queueFrames.slice(i, i + GAME_COL));
  const firstEmptyCourt = courts.find((c) => c.status === 'EMPTY' && !playingByCourtId.get(c.id));
  // 게임 그리드 열 수(반응형) — 가운데 폭(전체 - 오른쪽 대기 300) 기준. 40~50명도 덜 스크롤.
  const centerW = layout.width - 320;
  const gameColW: any = centerW > 1380 ? '32.5%' : centerW > 860 ? '49%' : '100%';
  // 선수 칩 — 탭하면 선택(다시 탭=해제). 선택된 선수는 강조. 옮길 곳은 게임/대기 칸을 탭.
  const PlayerTag = ({ player, fill, compact, block, order, big }: { player: Player; fill?: boolean; compact?: boolean; block?: boolean; order?: number; big?: boolean }) => {
    const skill = getSkillMeta(player.skillLevel);
    const g = getGenderMeta(player.gender);
    const busy = busySet.has(player.userId);
    const selected = selectedPlayer === player.userId;
    // 카드 색 = 성별(남=파랑/여=연노랑). 빨강은 에러처럼 보여 피함. 안의 급수 배지만 급수 색.
    const gCol = !g ? colors.border : g.gender === 'M' ? '#2563EB' : '#CA8A04';
    const gBg = !g ? colors.surface : g.gender === 'M' ? '#EFF6FF' : '#FEFCE8';
    // 드래그(모드1처럼): 6px 이상 움직이면 beginPoolDrag — 게임/대기 칸에 끌어다 놓기. 탭은 onPress(선택/스왑) 그대로.
    const pan = useRef(PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gg) => Math.abs(gg.dx) > 6 || Math.abs(gg.dy) > 6,
      onPanResponderGrant: (e) => beginPoolDrag(player.userId, player.userName, player.skillLevel, e.nativeEvent.pageX, e.nativeEvent.pageY),
      onPanResponderMove: (e) => {
        if (Platform.OS === 'web') return;
        const { pageX, pageY } = e.nativeEvent;
        setPoolDrag((prev) => (prev ? { ...prev, x: pageX, y: pageY } : prev));
        const hit = hitTestDrop(pageX, pageY, ['frame', 'pool']);
        setHoverDropId(hit ? hit.id : null);
      },
      onPanResponderRelease: (e) => {
        if (Platform.OS === 'web') return;
        const { pageX, pageY } = e.nativeEvent;
        const dragged = poolDragRef.current?.userId;
        poolDragRef.current = null; setPoolDrag(null); setHoverDropId(null);
        if (dragged) resolveDrop(dragged, pageX, pageY);
      },
      onPanResponderTerminate: () => { poolDragRef.current = null; setPoolDrag(null); setHoverDropId(null); },
    })).current;
    const onPointerDownWeb = (ev: any) => {
      if (Platform.OS !== 'web') return;
      if (ev.button != null && ev.button !== 0) return;
      const startX = ev.pageX, startY = ev.pageY; let started = false;
      const w = window as any;
      const onMove = (e: PointerEvent) => {
        if (!started) {
          if (Math.abs(e.pageX - startX) <= 6 && Math.abs(e.pageY - startY) <= 6) return;
          started = true;
          beginPoolDrag(player.userId, player.userName, player.skillLevel, e.pageX, e.pageY);
        }
        if (started) { w.removeEventListener('pointermove', onMove, true); w.removeEventListener('pointerup', onUp, true); }
      };
      const onUp = () => { w.removeEventListener('pointermove', onMove, true); w.removeEventListener('pointerup', onUp, true); };
      w.addEventListener('pointermove', onMove, true);
      w.addEventListener('pointerup', onUp, true);
    };
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        {...pan.panHandlers}
        {...(Platform.OS === 'web' ? { onPointerDown: onPointerDownWeb } : {})}
        onPress={() => {
          if (!selectedPlayer || selectedPlayer === player.userId) { setSelectedPlayer(selectedPlayer === player.userId ? null : player.userId); return; }
          // 선택 중 + 다른 선수 탭: 큐 게임 선수면 스왑(탭한 사람 대기로), 대기 선수면 선택 전환
          if (queuedEntries.some((e) => e.playerIds.includes(player.userId))) swapSelectedWith(player.userId);
          else setSelectedPlayer(player.userId);
        }}
        onLongPress={() => setMatchupTarget({ userId: player.userId, name: player.userName, skillLevel: player.skillLevel, isGuest: (player as any).isGuest })}
        delayLongPress={300}
        style={[styles.poolTag, compact && (big ? styles.poolTagBig : styles.poolTagCompact), fill ? { flex: 1, minWidth: 0 } : block ? { width: '100%' } : { width: MAG_W }, { borderColor: selected ? colors.primary : gCol, borderWidth: selected ? 3 : 2, backgroundColor: selected ? 'rgba(16,185,129,0.14)' : gBg, zIndex: selected ? 9 : 1 }]}
        accessibilityLabel={`${player.userName} ${g ? g.label : ''} ${selected ? '선택 해제' : '선택'} · 길게=정보·수정`}
      >
        {typeof order === 'number' && <View style={[styles.poolOrder, { backgroundColor: colors.surfaceSecondary }]}><Text style={[styles.poolOrderT, { color: colors.textSecondary }]}>{order}</Text></View>}
        <View style={[styles.magnetSkill, compact && (big ? styles.magnetSkillBig : styles.magnetSkillCompact), { backgroundColor: skill.color }]}><Text style={[styles.magnetSkillText, compact && { fontSize: big ? 13 : 11 }]}>{(player.skillLevel || '·').toUpperCase()}</Text></View>
        <Text style={[styles.magnetName, compact && (big ? styles.magnetNameBig : styles.magnetNameCompact), { color: colors.text }]} numberOfLines={1}>{player.userName}</Text>
        {g && <GenderMarker meta={g} size={compact ? (big ? 14 : 12) : 14} />}
        {compact
          ? <Text style={[styles.magnetGamesTiny, big && { fontSize: 12 }, { color: colors.textLight }]}>{player.gamesPlayedToday ?? 0}</Text>
          : <View style={[styles.magnetGames, { backgroundColor: colors.surfaceSecondary }]}><Text style={[styles.magnetGamesText, { color: colors.textSecondary }]}>{player.gamesPlayedToday ?? 0}</Text></View>}
        {busy && <View style={[styles.conflictDot, { borderColor: colors.surface }]} />}
      </TouchableOpacity>
    );
  };

  // 코트 카드(위 가로줄) — 게임중: 4명 칩(탭=교체) + 종료. 빈 코트: 탭=다음 게임 투입.
  const Mode2CourtCard = ({ court }: { court: Court }) => {
    const playingEntry = playingByCourtId.get(court.id);
    const occupied = court.status !== 'EMPTY' || !!playingEntry;
    const pids = playingEntry?.playerIds ?? court.currentTurn?.playerIds ?? [];
    const pnames = playingEntry?.playerNames ?? court.currentTurn?.playerNames ?? [];
    const turnId = court.currentTurn?.id ?? playingEntry?.turnId ?? null;
    return occupied ? (
      <View style={[styles.m2CourtCard, { borderColor: colors.warning, backgroundColor: colors.warningLight }]}>
        <View style={styles.m2CourtHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <Text style={[styles.m2CourtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
            <CourtElapsedBadge startedAt={court.currentTurn?.startedAt} />
          </View>
          <TouchableOpacity onPress={() => handleEndGame(court.id)} accessibilityLabel={`${court.name} 게임 종료`}><Text style={[styles.m2CourtState, { color: colors.danger }]}>종료</Text></TouchableOpacity>
        </View>
        <View style={styles.gameFrameSlots}>
          {[0, 1, 2, 3].map((s) => { const pid = pids[s]; const p = pid ? getPlayer(pid) : null; const sk = getSkillMeta(p?.skillLevel); const gm = getGenderMeta(p?.gender); return (
            <TouchableOpacity key={s} disabled={!pid || !turnId} activeOpacity={0.7} onPress={() => { if (turnId && pid) setRunningSwap({ turnId, outUserId: pid, courtName: court.name, currentIds: pids }); }} style={[styles.gameSlot, { borderColor: pid ? (gm ? (gm.gender === 'M' ? '#2563EB' : '#CA8A04') : sk.color) : colors.border, backgroundColor: gm ? (gm.gender === 'M' ? '#EFF6FF' : '#FEFCE8') : colors.surface }]} accessibilityLabel={pid ? `${p?.userName ?? pnames[s] ?? ''} ${gm?.label ?? ''} 교체` : '빈 칸'}>
              {pid ? (<><View style={[styles.slotSkill, { backgroundColor: sk.color }]}><Text style={styles.slotSkillText}>{(p?.skillLevel || '·').toUpperCase()}</Text></View><Text style={[styles.slotName, { color: colors.text }]} numberOfLines={1}>{p?.userName ?? pnames[s] ?? '선수'}</Text>{gm && <GenderMarker meta={gm} size={12} />}</>) : <Text style={[styles.slotEmpty, { color: colors.textLight }]}>·</Text>}
            </TouchableOpacity>
          ); })}
        </View>
      </View>
    ) : (
      <TouchableOpacity style={[styles.m2CourtCard, { borderColor: colors.primary, borderStyle: 'dashed', backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', minHeight: 70 }]} activeOpacity={0.7} onPress={() => assignQueueToCourt(court.id)} accessibilityLabel={`${court.name} 다음 게임 투입`}>
        <Text style={[styles.m2CourtName, { color: colors.text }]} numberOfLines={1}>{court.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Icon name="play" size={13} color={colors.primary} /><Text style={[styles.m2CourtState, { color: colors.primary }]}>탭=다음 게임 투입</Text></View>
      </TouchableOpacity>
    );
  };

  // 게임 중(코트 위) 게임 줄 — 코트명 + 4명. 선수 탭=교체, 종료 버튼. 조합 파악용(읽기).
  const LiveGameRow = ({ court, colW }: { court: Court; colW: any }) => {
    const e = playingByCourtId.get(court.id);
    const pids = e?.playerIds ?? court.currentTurn?.playerIds ?? [];
    const pnames = e?.playerNames ?? court.currentTurn?.playerNames ?? [];
    const turnId = court.currentTurn?.id ?? e?.turnId ?? null;
    return (
      <View style={[styles.gameFrame, { width: colW, borderColor: colors.warning, backgroundColor: colors.warningLight }]}>
        <View style={styles.gameFrameHead}>
          <View style={styles.gameFrameNoWrap}>
            <View style={[styles.gameNoBadge, { backgroundColor: colors.warning }]}><Icon name="play" size={11} color="#fff" /></View>
            <Text style={[styles.gameFrameNo, { color: colors.warning }]} numberOfLines={1}>{court.name} · 게임 중</Text>
          </View>
          <TouchableOpacity onPress={() => handleEndGame(court.id)} accessibilityLabel={`${court.name} 게임 종료`}><Text style={[styles.gameFrameWait, { color: colors.danger }]}>종료</Text></TouchableOpacity>
        </View>
        <View style={styles.gameFrameSlots}>
          {[0, 1, 2, 3].map((s) => {
            const pid = pids[s]; const p = pid ? getPlayer(pid) : null; const sk = getSkillMeta(p?.skillLevel);
            return (
              <TouchableOpacity key={s} disabled={!pid || !turnId} activeOpacity={0.7}
                onPress={() => { if (turnId && pid) setRunningSwap({ turnId, outUserId: pid, courtName: court.name, currentIds: pids }); }}
                style={[styles.gameSlot, { borderColor: pid ? sk.color : colors.border, backgroundColor: colors.surface }]}
                accessibilityLabel={pid ? `${p?.userName ?? pnames[s] ?? ''} 교체` : '빈 칸'}>
                {pid ? (<><View style={[styles.slotSkill, { backgroundColor: sk.color }]}><Text style={styles.slotSkillText}>{(p?.skillLevel || '·').toUpperCase()}</Text></View><Text style={[styles.slotName, { color: colors.text }]} numberOfLines={1}>{p?.userName ?? pnames[s] ?? '선수'}</Text>{p && getGenderMeta(p.gender) && <GenderMarker meta={getGenderMeta(p.gender)!} size={12} />}</>) : <Text style={[styles.slotEmpty, { color: colors.textLight }]}>·</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // 지난 게임 줄(대기 기록) — 코트에서 끝난 4명 묶음. 어떻게 편성됐는지 확인용(읽기).
  const CompletedGameRow = ({ rec }: { rec: { id: string; playerIds: string[]; names: Record<string, string> } }) => (
    <View style={[styles.gameFrame, { width: '100%', borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.gameFrameHead}>
        <View style={styles.gameFrameNoWrap}>
          <View style={[styles.gameNoBadge, { backgroundColor: colors.textLight }]}><Icon name="history" size={10} color="#fff" /></View>
          <Text style={[styles.gameFrameNo, { color: colors.textLight }]}>지난 게임</Text>
        </View>
      </View>
      <View style={styles.gameFrameSlots}>
        {rec.playerIds.slice(0, 4).map((id, s) => { const p = getPlayer(id); const nm = p?.userName ?? rec.names[id] ?? '선수'; const sk = getSkillMeta(p?.skillLevel); return (
          <View key={`${id}-${s}`} style={[styles.gameSlot, { borderColor: sk.color, backgroundColor: colors.surface }]}>
            <View style={[styles.slotSkill, { backgroundColor: sk.color }]}><Text style={styles.slotSkillText}>{(p?.skillLevel || '·').toUpperCase()}</Text></View>
            <Text style={[styles.slotName, { color: colors.text }]} numberOfLines={1}>{nm}</Text>
          </View>
        ); })}
      </View>
    </View>
  );

  // 게임 칸 — 번호 배지 + 'N번 게임' + 4명. 선수 선택 중이면 '여기로' 대상으로 강조, 탭하면 이동.
  const GameFrame = ({ frame, idx, colW }: { frame: { id: string | null; players: string[] }; idx: number; colW: any }) => {
    const members = frame.players;
    const full = members.length === 4;
    const isNew = frame.id === null;
    const target = !!selectedPlayer && !members.includes(selectedPlayer);
    // 드롭존 등록(드래그한 선수를 이 게임으로). 위치는 보드/창 변할 때 다시 측정.
    const frameRef = useRef<View>(null);
    const dropId = `m2frame-${frame.id ?? 'new'}`;
    const hovered = hoverDropId === dropId;
    useEffect(() => {
      const t = setTimeout(() => {
        frameRef.current?.measureInWindow((x, y, w, h) => {
          registerDrop({ id: dropId, kind: 'frame', entryId: frame.id ?? undefined, slotIndex: 0, rect: { x, y, w, h } });
        });
      }, 60);
      return () => { clearTimeout(t); unregisterDrop(dropId); };
    }, [dropId, queuedEntries.length, members.length, idx, layout.width]);
    const lit = target || hovered;
    return (
      <View ref={frameRef} style={[styles.gameFrame, { width: colW, borderColor: lit ? colors.primary : full ? colors.primary : colors.border, borderWidth: lit ? 3 : 2, backgroundColor: lit ? 'rgba(16,185,129,0.10)' : colors.surface }]}>
        <TouchableOpacity style={styles.gameFrameHead} activeOpacity={selectedPlayer ? 0.6 : 1} disabled={!selectedPlayer} onPress={() => { if (selectedPlayer) moveSelectedToGame(frame.id); }}>
          <View style={styles.gameFrameNoWrap}>
            <View style={[styles.gameNoBadge, { backgroundColor: isNew ? colors.textLight : idx === 0 ? colors.primary : colors.text }]}><Text style={styles.gameNoBadgeT}>{isNew ? '＋' : idx + 1}</Text></View>
            <Text style={[styles.gameFrameNo, { color: isNew ? colors.textLight : idx === 0 ? colors.primary : colors.text }]}>{isNew ? '새 게임' : idx === 0 ? '다음 차례' : `${idx + 1}번째`}</Text>
            <Text style={[styles.gameFrameCount, { color: target ? colors.primary : colors.textLight }]}>{target ? '여기로 ▼' : `${members.length}/4`}</Text>
          </View>
          {/* 게임 순서(게임 하는 순서) 이동 ▲▼ + 삭제 × — 선수 선택 중이 아닐 때만. */}
          {!isNew && !selectedPlayer && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }} {...(Platform.OS === 'web' ? { onPointerDown: (e: any) => e.stopPropagation?.() } : {})}>
              <TouchableOpacity disabled={idx === 0} onPress={() => moveQueueItem(idx, idx - 1)} hitSlop={4} style={styles.gameOrderBtn} accessibilityLabel={`${idx + 1}번째 게임 앞으로`}>
                <Text style={[styles.gameOrderT, { color: idx === 0 ? colors.border : colors.textSecondary }]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={idx >= queuedEntries.length - 1} onPress={() => moveQueueItem(idx, idx + 1)} hitSlop={4} style={styles.gameOrderBtn} accessibilityLabel={`${idx + 1}번째 게임 뒤로`}>
                <Text style={[styles.gameOrderT, { color: idx >= queuedEntries.length - 1 ? colors.border : colors.textSecondary }]}>▼</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => showConfirm('게임 삭제', '이 게임을 지울까요? 선수들은 대기로 갑니다.', async () => { try { await deleteEntry(frame.id!); loadBoard(); loadPool(); showSuccess('게임 삭제'); } catch (e: any) { showAlert('오류', '삭제 실패'); } })}
                hitSlop={6} style={styles.gameDelBtn} accessibilityLabel={`${idx + 1}번째 게임 삭제`}>
                <Icon name="close" size={13} color={colors.textLight} />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.gameFrameSlots}>
          {[0, 1, 2, 3].map((s) => {
            const pid = members[s]; const p = pid ? getPlayer(pid) : null;
            return p ? (
              <PlayerTag key={s} player={p} fill compact big />
            ) : (
              <TouchableOpacity key={s} disabled={!selectedPlayer} activeOpacity={0.6} onPress={() => { if (selectedPlayer) moveSelectedToGame(frame.id); }} style={[styles.gameSlotEmpty, { borderColor: target ? colors.primary : colors.border, backgroundColor: target ? 'rgba(16,185,129,0.10)' : 'transparent' }]}>
                <Text style={[styles.slotEmpty, { color: target ? colors.primary : colors.textLight }]}>＋</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // 대기 영역 — 선수 선택 중이면 탭해서(또는 끌어다 놓아) 그 선수를 게임에서 빼 대기로(서버).
  const PoolDropZone = ({ children }: { children: React.ReactNode }) => {
    const target = !!selectedPlayer;
    const poolRef = useRef<View>(null);
    const dropId = 'm2pool';
    const hovered = hoverDropId === dropId;
    useEffect(() => {
      const t = setTimeout(() => {
        poolRef.current?.measureInWindow((x, y, w, h) => {
          registerDrop({ id: dropId, kind: 'pool', slotIndex: 0, rect: { x, y, w, h } });
        });
      }, 60);
      return () => { clearTimeout(t); unregisterDrop(dropId); };
    }, [pool.length, layout.width]);
    const lit = target || hovered;
    return (
      <TouchableOpacity ref={poolRef} activeOpacity={target ? 0.7 : 1} disabled={!target} onPress={() => removeSelectedToPool()}
        style={[styles.poolZone, { borderColor: lit ? colors.primary : 'transparent', backgroundColor: lit ? 'rgba(16,185,129,0.08)' : 'transparent' }]}>
        {lit && <Text style={[styles.m2SectionLabel, { color: colors.primary, width: '100%' }]}>여기에 놓으면 대기로 ▼</Text>}
        {children}
      </TouchableOpacity>
    );
  };

  const BoardMode2 = (
    <View style={styles.m2Wrap}>
      {/* 코트: 위 가로줄 — 빈 코트 탭=다음 게임 투입 */}
      <View style={styles.m2CourtTopRow}>
        {courts.length === 0
          ? <Text style={[styles.emptyPool, { color: colors.textLight }]}>코트가 없어요. "코트 관리"에서 추가</Text>
          : courts.map((court) => <Mode2CourtCard key={court.id} court={court} />)}
      </View>
      {/* 선택 배너 / 안내 + 자동 편성 */}
      {selectedPlayer ? (
        <View style={[styles.m2SelectBar, { backgroundColor: colors.primary }]}>
          <Text style={styles.m2SelectBarT} numberOfLines={1}>✋ {getPlayer(selectedPlayer)?.userName || '선수'} 들고 있음 · 놓을 게임/대기를 탭(또는 드래그) — 4명이면 그 자리 사람이 다시 들립니다</Text>
          <TouchableOpacity onPress={() => setSelectedPlayer(null)} style={styles.m2SelectCancel}><Text style={styles.m2SelectCancelT}>취소</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.m2LeftHead}>
          {/* 텍스트 명령 — 평소엔 작은 버튼, 탭하면 입력창이 올라온다. 이름=편성, '코트N 이름…'=투입, '이름 급수 X'=수정 */}
          {cmdOpen ? (
            <View style={[styles.m2CmdWrap, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
              <Icon name="edit" size={14} color={colors.textLight} />
              <TextInput
                autoFocus value={cmd} onChangeText={setCmd} onSubmitEditing={runCommand} returnKeyType="go"
                placeholder="신예준 김도윤 이지유 강수아 · 코트1 … · 신예준 급수 A"
                placeholderTextColor={colors.textLight}
                style={[styles.m2CmdInput, { color: colors.text }]} />
              <TouchableOpacity onPress={runCommand} disabled={!cmd.trim()} style={[styles.m2CmdBtn, { backgroundColor: cmd.trim() ? colors.primary : colors.surfaceSecondary }]} accessibilityLabel="명령 실행">
                <Text style={[styles.m2CmdBtnT, { color: cmd.trim() ? '#fff' : colors.textLight }]}>실행</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setCmdOpen(false); setCmd(''); }} hitSlop={6} style={{ paddingHorizontal: 2 }} accessibilityLabel="명령창 닫기"><Icon name="close" size={15} color={colors.textLight} /></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setCmdOpen(true)} style={[styles.m2CmdToggle, { borderColor: colors.border, backgroundColor: colors.surface }]} accessibilityLabel="텍스트 명령창 열기">
              <Icon name="edit" size={13} color={colors.primary} /><Text style={[styles.m2CmdToggleT, { color: colors.primary }]}>명령</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.m2AutoBtn, { borderColor: colors.primary }]} onPress={() => autoFillQueue(poolIds)} accessibilityLabel="대기 인원 자동 편성">
            <Icon name="rotation" size={13} color={colors.primary} /><Text style={[styles.m2AutoBtnT, { color: colors.primary }]}>자동 편성</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* 아래: 게임판(가운데) + 대기=게임 기록(오른쪽) */}
      <View style={styles.m2Body}>
        <ScrollView style={styles.m2Center} contentContainerStyle={styles.m2CenterScroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.m2SectionLabel, { color: colors.textSecondary }]}>다음 게임 · {GAME_COL}개씩 세로 · 선수 탭/드래그로 편성</Text>
          <View style={styles.m2GameCols}>
            {gameColumns.map((col, ci) => (
              <View key={ci} style={styles.m2GameCol}>
                {col.map((f, j) => <GameFrame key={f.id ?? `new${ci}`} frame={f} idx={ci * GAME_COL + j} colW="100%" />)}
              </View>
            ))}
          </View>
        </ScrollView>
        {/* 분할 디바이더 — 끌어서 가운데 게임판 ↔ 오른쪽 대기판 크기 조절(모드1 분할처럼) */}
        <View style={[styles.m2Divider, Platform.OS === 'web' ? ({ cursor: 'col-resize' } as any) : null]} {...m2DividerPan.panHandlers}>
          <View style={[styles.m2DividerBar, { backgroundColor: colors.textLight }]} />
        </View>
        {/* 오른쪽 대기판 = 대기 명단을 '같이 나온 4명'끼리 한 줄로 정렬. 그 4명을 탭→다음 게임으로 재편성. */}
        <View style={[styles.m2PoolRight, { borderLeftColor: colors.border, width: m2RightWidth }]}>
          <Text style={[styles.m2PanelTitle, { color: colors.text }]}>대기 명단 ({pool.length}) · 급수순</Text>
          {/* 대기 명단 검색 + 성별 필터 — 가운데 게임은 그대로, 대기만 추림 */}
          <View style={styles.m2PoolSearchRow}>
            <TextInput value={poolQuery} onChangeText={setPoolQuery} placeholder="대기 검색" placeholderTextColor={colors.textLight}
              style={[styles.m2PoolSearch, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]} />
            {poolQuery !== '' && <TouchableOpacity onPress={() => setPoolQuery('')} style={styles.m2PoolSearchClear}><Icon name="close" size={13} color={colors.textLight} /></TouchableOpacity>}
            {(['all', 'M', 'F'] as const).map((gf) => {
              const on = gf === 'all' ? poolGenders.length === 0 : poolGenders.includes(gf);
              return (
                <TouchableOpacity key={gf} onPress={() => (gf === 'all' ? setPoolGenders([]) : setPoolGenders((p) => toggleIn(p, gf)))}
                  style={[styles.m2GChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? 'rgba(16,185,129,0.12)' : colors.surface }]}>
                  <Text style={[styles.m2GChipT, { color: on ? colors.primary : colors.textSecondary }]}>{gf === 'all' ? '전체' : gf === 'M' ? '남' : '여'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* 급수 필터(다중선택) — 전체 + S A B C D E F */}
          <View style={[styles.m2PoolSearchRow, { flexWrap: 'wrap' }]}>
            {(['all', 'S', 'A', 'B', 'C', 'D', 'E', 'F'] as const).map((sk) => {
              const on = sk === 'all' ? poolSkills.length === 0 : poolSkills.includes(sk);
              return (
                <TouchableOpacity key={sk} onPress={() => (sk === 'all' ? setPoolSkills([]) : setPoolSkills((p) => toggleIn(p, sk)))}
                  style={[styles.m2SkChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? 'rgba(16,185,129,0.12)' : colors.surface }]}>
                  <Text style={[styles.m2GChipT, { color: on ? colors.primary : colors.textSecondary }]}>{sk === 'all' ? '전체' : sk}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* 대기 = 같이 나온 4명 묶음을 4명 한 줄로, 세로로 아래로 쌓는다(아래로 스크롤). 게임 중은 맨 밑. */}
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <PoolDropZone>
              {pool.length === 0 && playingCols.length === 0
                ? <Text style={[styles.emptyPool, { color: colors.textLight }]}>대기 인원 없음</Text>
                : (
                  <View style={{ width: '100%', gap: 5 }}>
                    {poolGroups.map((grp, gi) => (
                      <View key={gi} style={styles.gameFrameSlots}>
                        {[0, 1, 2, 3].map((si) => {
                          const id = grp[si]; // string=선수, undefined=마지막 줄 채우기 패딩(투명)
                          if (!id) return <View key={si} style={styles.poolGapSlot} />;
                          const p = getPlayer(id); return p ? <PlayerTag key={id} player={p} fill compact /> : <View key={si} style={styles.poolGapSlot} />;
                        })}
                      </View>
                    ))}
                    {/* 방금 끝난 게임 — 묶음마다 'N분 전'이면 목록이 너무 길어 → 시간 구간(15/30/60분 이상
                        편성 안 됨)으로 묶어 '헤더만' 표시. 오래 기다린(긴 구간) 묶음이 위, 최근이 아래로 쌓임. */}
                    {(() => {
                      const bucketOf = (min: number) =>
                        min >= 60 ? { label: '⏱ 1시간 이상 편성 안 됨', color: colors.danger }
                        : min >= 30 ? { label: '⏱ 30분 이상 편성 안 됨', color: colors.warning }
                        : min >= 15 ? { label: '⏱ 15분 이상 편성 안 됨', color: '#CA8A04' }
                        : { label: '방금 끝난 게임', color: colors.textSecondary };
                      let lastLabel: string | null = null;
                      return finishedGroups.map((g, gi) => {
                        const waitMin = Math.max(0, Math.floor((nowTs - g.at) / 60000));
                        const bk = bucketOf(waitMin);
                        const showHeader = bk.label !== lastLabel; lastLabel = bk.label;
                        return (
                          <View key={`fin${gi}`} style={{ gap: 2 }}>
                            {showHeader && <Text style={[styles.m2SectionLabel, { color: bk.color, marginTop: 6 }]}>{bk.label}</Text>}
                            <View style={styles.gameFrameSlots}>
                              {[0, 1, 2, 3].map((si) => {
                                const id = g.slots[si];
                                if (!id) return <View key={si} style={styles.poolGapSlot} />;
                                const p = getPlayer(id); return p ? <PlayerTag key={id} player={p} fill compact /> : <View key={si} style={styles.poolGapSlot} />;
                              })}
                            </View>
                          </View>
                        );
                      });
                    })()}
                    {/* 코트에서 게임 중인 묶음 — 맨 밑에 4명 한 줄로. 끌어다 놓아 다음 게임 미리 편성. */}
                    {playingCols.length > 0 && <Text style={[styles.m2SectionLabel, { color: colors.warning, marginTop: 6 }]}>게임 중 · 끌어서 다음 게임 미리 편성</Text>}
                    {playingCols.map((pc, i) => (
                      <View key={`play${i}`} style={[styles.gameFrameSlots, { borderTopWidth: 1, borderTopColor: colors.warningLight, paddingTop: 4 }]}>
                        {pc.ids.map((id) => { const p = getPlayer(id); return p ? <PlayerTag key={id} player={p} fill compact /> : null; })}
                      </View>
                    ))}
                  </View>
                )}
            </PoolDropZone>
          </ScrollView>
        </View>
      </View>
    </View>
  );

  // 모드 2 — 헤더 + 모드 탭 + 게임판 레이아웃. 드래그 오버레이/모달은 모드 1과 공통.
  if (boardMode === 2) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        {ModeTabs}
        <View style={styles.mode2Toolbar}>
          <View style={{ flex: 1 }}>{PoolSearch}</View>
        </View>
        {BoardMode2}
        {DragOverlay}
        {QueueDragOverlay}
        {modals}
      </SafeAreaView>
    );
  }

  if (twoPane) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        {ModeTabs}
        <View style={styles.split} onLayout={onSplitLayout}>
          {/* LEFT PANE — pool boxes + tray */}
          <View style={[styles.leftPane, { borderRightColor: colors.border }, leftPaneWidth != null && { width: leftPaneWidth }]}>
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
            {/* 방금 나온은 그룹 보기라 가나다 검색이 의미 없으니 검색줄을 숨긴다. */}
            {poolTab !== 'recent' && PoolSearch}
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

          {SplitDivider}

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
      {ModeTabs}
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
        {/* 방금 나온은 그룹 보기라 가나다 검색이 의미 없으니 검색줄을 숨긴다. */}
        {poolTab !== 'recent' && PoolSearch}
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
  colors, freePool, queuedPool, currentIds, onPick, onClose, allowAddToEmpty, canRemove, onRemove,
}: {
  colors: any;
  freePool: Player[];
  queuedPool: Player[];
  currentIds: string[];
  onPick: (id: string) => void;
  onClose: () => void;
  /** true when the tapped slot is EMPTY (game has <4 players) → adding, not replacing. */
  allowAddToEmpty?: boolean;
  /** true면 이 슬롯에 선수가 있어 '빼기'(제거) 가능 — 교체 모드에서만. */
  canRemove?: boolean;
  /** 이 자리 선수를 게임에서 제거(인원 줄이기). */
  onRemove?: () => void;
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
          {/* 교체 대신 이 자리 선수를 게임에서 빼기(인원 줄이기). 채워진 슬롯에서만. */}
          {canRemove && onRemove && (
            <TouchableOpacity
              style={[modalStyles.removeBtn, { borderColor: colors.danger }]}
              onPress={onRemove}
              activeOpacity={0.85}
              accessibilityLabel="이 자리에서 빼기"
            >
              <Icon name="close" size={15} color={colors.danger} />
              <Text style={[modalStyles.removeBtnText, { color: colors.danger }]}>이 자리에서 빼기 (인원 줄이기)</Text>
            </TouchableOpacity>
          )}
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
  colors, clubSessionId, userId, name, skillLevel, isGuest, isInLesson, onToggleLesson, onCheckout, onSaved, onClose,
}: {
  colors: any;
  clubSessionId: string;
  userId: string;
  name: string;
  /** 현재 급수 (null = 미설정). 수정 폼 초기값으로 사용. */
  skillLevel: string | null;
  /** 게스트면 헤더에 게스트 배지 표시. */
  isGuest: boolean;
  /** 현재 레슨 중 여부 — 토글 버튼 라벨/상태를 결정. */
  isInLesson: boolean;
  /** 레슨 시작/종료 토글 (반대 상태로 전환). */
  onToggleLesson: () => void;
  onCheckout: () => void;
  /** 저장 성공 후 부모가 풀을 갱신하도록 콜백 (갱신된 이름 전달). */
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<PlayerMatchups | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── 운영자: 이름·급수 수정 폼 (체크아웃 옆 토글) ───
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  // '' = 미설정. 급수 칩 토글로 설정/해제.
  const [editSkill, setEditSkill] = useState<string>(skillLevel ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    clubSessionApi.getMatchups(clubSessionId, userId)
      .then(({ data }) => { if (alive) setData(data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clubSessionId, userId]);

  const openEdit = useCallback(() => {
    setEditName(name);
    setEditSkill(skillLevel ?? '');
    setEditing(true);
  }, [name, skillLevel]);

  const saveEdit = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed) { showAlert('알림', '이름을 입력해주세요'); return; }
    setSaving(true);
    try {
      const { data: updated } = await clubSessionApi.editPlayer(clubSessionId, userId, {
        name: trimmed,
        // null 이면 미설정으로 초기화, 값이 있으면 그 급수로 설정.
        skillLevel: editSkill ? editSkill : null,
      });
      showSuccess(`${updated.name}님 정보 수정됨`);
      setEditing(false);
      onSaved(updated.name);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || err?.response?.data?.message || '수정에 실패했어요');
    } finally {
      setSaving(false);
    }
  }, [clubSessionId, userId, editName, editSkill, onSaved]);

  const partners = data?.partners ?? [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, modalStyles.matchupSheet, { backgroundColor: colors.surface }]}>
          <View style={modalStyles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <View style={modalStyles.matchupTitleRow}>
                <Text style={[modalStyles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {name}
                </Text>
                {isGuest && (
                  <View style={[modalStyles.guestBadge, { backgroundColor: colors.warningLight }]}>
                    <Text style={[modalStyles.guestBadgeText, { color: colors.warning }]}>게스트</Text>
                  </View>
                )}
              </View>
              <Text style={[modalStyles.matchupSub, { color: colors.textSecondary }]}>
                오늘 함께 친 사람{data != null ? ` · 오늘 ${data.totalGames}게임` : ''}
              </Text>
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
                    {g && <GenderMarker meta={g} size={15} />}
                    <View style={{ flex: 1 }} />
                    <View style={[modalStyles.matchupCount, { backgroundColor: colors.primaryBg }]}>
                      <Text style={[modalStyles.matchupCountText, { color: colors.primary }]}>{p.count}번</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* 운영자 인라인 수정 폼: 이름표를 고치듯 이름/급수 수정. '이름·급수 수정'
              버튼을 누르면 펼쳐진다. '' = 미설정. */}
          {editing && (
            <View style={[modalStyles.editForm, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>이름</Text>
              <TextInput
                style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="이름"
                placeholderTextColor={colors.textLight}
                maxLength={20}
                accessibilityLabel="이름 입력"
              />

              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>급수</Text>
              <View style={modalStyles.skillRow}>
                {SKILL_LEVELS.map((lv) => {
                  const meta = getSkillMeta(lv);
                  const active = editSkill === lv;
                  return (
                    <TouchableOpacity
                      key={lv}
                      style={[
                        modalStyles.skillChip,
                        { borderColor: active ? meta.color : colors.border, backgroundColor: active ? meta.color : colors.surface },
                      ]}
                      onPress={() => setEditSkill(lv)}
                      activeOpacity={0.8}
                      accessibilityLabel={`급수 ${lv}`}
                    >
                      <Text style={[modalStyles.skillChipText, { color: active ? palette.white : colors.textSecondary }]}>{lv}</Text>
                    </TouchableOpacity>
                  );
                })}
                {/* 미설정(급수 없음) */}
                <TouchableOpacity
                  style={[
                    modalStyles.skillChipWide,
                    { borderColor: !editSkill ? colors.textSecondary : colors.border, backgroundColor: !editSkill ? colors.surfaceSecondary : colors.surface },
                  ]}
                  onPress={() => setEditSkill('')}
                  activeOpacity={0.8}
                  accessibilityLabel="급수 미설정"
                >
                  <Text style={[modalStyles.skillChipText, { color: colors.textSecondary }]}>미설정</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[modalStyles.submitBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
                onPress={saveEdit}
                disabled={saving}
                activeOpacity={0.85}
                accessibilityLabel="이름·급수 저장"
              >
                {saving ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <Text style={modalStyles.submitBtnText}>저장</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* 레슨 토글 — 레슨 중이면 자동추천/미편성 풀에서 빼고 '레슨자' 박스로
              (수동으로만 코트 배정). 다시 누르면 로테이션 복귀. */}
          <TouchableOpacity
            style={[modalStyles.checkoutBtn, { borderColor: colors.info, backgroundColor: isInLesson ? colors.infoBg : 'transparent' }]}
            onPress={onToggleLesson}
            activeOpacity={0.85}
            accessibilityLabel={isInLesson ? `${name} 레슨 종료` : `${name} 레슨 시작`}
          >
            <Text style={[modalStyles.checkoutBtnText, { color: colors.info }]}>
              {isInLesson ? '🎓 레슨 종료 (로테이션 복귀)' : '🎓 레슨 시작 (로테이션 제외)'}
            </Text>
          </TouchableOpacity>

          {/* 운영자 액션 행: [이름·급수 수정] [체크아웃] — 사용자가 한 것 없이
              운영자가 이름표를 고치고/내보낼 수 있다. 매치업 탭은 안 건드림. */}
          <View style={modalStyles.matchupActions}>
            <TouchableOpacity
              style={[modalStyles.editBtn, { borderColor: colors.primary, backgroundColor: editing ? colors.primaryBg : 'transparent' }]}
              onPress={() => (editing ? setEditing(false) : openEdit())}
              activeOpacity={0.85}
              accessibilityLabel={`${name} 이름·급수 수정`}
            >
              <Icon name="edit" size={15} color={colors.primary} />
              <Text style={[modalStyles.checkoutBtnText, { color: colors.primary }]}>
                {editing ? '수정 닫기' : '이름·급수 수정'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[modalStyles.checkoutBtn, modalStyles.actionFlex, { borderColor: colors.danger }]}
              onPress={onCheckout}
              activeOpacity={0.85}
              accessibilityLabel={`${name} 체크아웃 시키기`}
            >
              <Icon name="close" size={16} color={colors.danger} />
              <Text style={[modalStyles.checkoutBtnText, { color: colors.danger }]}>
                체크아웃
              </Text>
            </TouchableOpacity>
          </View>
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
  const [gender, setGender] = useState<Gender | null>(null);
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
        ...(gender ? { gender } : {}),
        ...(feeAmount && feeAmount > 0 ? { feeAmount } : {}),
      });
      showSuccess('게스트 추가 완료!');
      onAdded();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || err.response?.data?.message || '게스트 추가 실패');
    } finally {
      setSubmitting(false);
    }
  }, [name, skill, gender, fee, sessionId, onAdded]);

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

          <Text style={[modalStyles.label, { color: colors.textSecondary }]}>성별 (선택)</Text>
          <View style={modalStyles.skillRow}>
            {(['M', 'F'] as Gender[]).map((g) => {
              const meta = GENDER_META[g];
              const active = gender === g;
              return (
                <TouchableOpacity
                  key={g}
                  style={[
                    modalStyles.genderChip,
                    { borderColor: active ? meta.color : colors.border, backgroundColor: active ? meta.color : colors.background },
                  ]}
                  onPress={() => setGender(active ? null : g)}
                  activeOpacity={0.8}
                  accessibilityLabel={`성별 ${meta.label}`}
                >
                  <GenderMarker meta={meta} size={18} color={active ? palette.white : meta.color} />
                  <Text style={[modalStyles.genderChipLabel, { color: active ? palette.white : colors.textSecondary }]}>
                    {meta.label}
                  </Text>
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
  // Tablet+ comfortable touch target for the wide inline header pills (a 44pt
  // min hit area). Phones keep the compact narrow-header sizing above.
  headerLinkTablet: {
    paddingVertical: spacing.smd, paddingHorizontal: spacing.lg, minHeight: 44,
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
  // 2분할 크기 조절 막대 — 드래그 가능한 가는 세로 바 + 가운데 grab handle.
  splitDivider: {
    width: 14, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'col-resize', userSelect: 'none' } as any) : null),
  },
  splitDividerHandle: { width: 4, height: 48, borderRadius: 2 },
  rightContent: { gap: spacing.sm, paddingBottom: spacing.xl },

  colHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colHeader: { ...typography.overline, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },

  // 선수 검색 — 슬림한 한 줄 입력. 풀 그리드 사이즈에 영향을 주지 않도록 풀 위에만 둠.
  poolSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: Platform.OS === 'web' ? 6 : 4,
    borderWidth: 1, borderRadius: radius.lg, marginBottom: spacing.xs,
  },
  poolSearchInput: { ...typography.body2, flex: 1, paddingVertical: 2, ...(Platform.OS === 'web' ? { outlineWidth: 0 as any } : null) },

  // ─── 풀 다중 필터 (급수/성별/게임수) ───
  poolSearchWrap: {},
  poolFilterToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 4,
    borderWidth: 1, borderRadius: radius.md,
  },
  poolFilterBadge: {
    minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  poolFilterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 14 },
  poolFilterPanel: {
    borderWidth: 1, borderRadius: radius.lg, padding: spacing.sm,
    marginBottom: spacing.sm, gap: spacing.xs,
  },
  poolFilterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  poolFilterRowLabel: { ...typography.caption, width: 38, paddingTop: 5 },
  poolFilterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1 },
  filterChip: {
    minWidth: 30, paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  filterChipText: { ...typography.buttonSm },
  poolFilterClear: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 5, marginTop: 2,
  },
  poolFilterClearText: { ...typography.caption },

  poolActionsWrap: { marginBottom: spacing.xs, gap: spacing.xs },
  poolActions: { flexDirection: 'row', gap: spacing.sm },
  poolActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.lg,
  },
  poolActionText: { ...typography.buttonSm },
  // 테스트/데모용 랜덤 게스트 (실제 출석 아님)
  testGuestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: 6, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.lg,
  },
  testGuestLabel: { ...typography.caption, flex: 1 },
  testGuestBtn: {
    minWidth: 44, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 5, paddingHorizontal: 10,
    borderWidth: 1, borderRadius: radius.md,
  },
  testGuestBtnText: { ...typography.buttonSm },

  // 풀 보기 전환 탭(그룹별 | 전체) — 컴팩트 세그먼트 컨트롤. 트랙은 옅은
  // surfaceSecondary, 선택 탭만 surface 로 떠 보이게.
  // 운영판 모드 전환(기본 | 게임판) — 헤더 바로 아래, 한눈에 띄는 라벨 + 강조 탭.
  modeTabsRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, borderBottomWidth: 1,
  },
  modeTabsLabel: { ...typography.caption, fontWeight: '700' },
  modeTabs: { flexDirection: 'row', padding: 3, borderRadius: radius.lg, borderWidth: 1, gap: 3 },
  modeTab: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', minWidth: 96,
  },
  modeTabText: { ...typography.buttonSm, fontWeight: '700' },

  // 모드 2 선택 바 — 게임판 선택 인원 요약 + 액션.
  mode2SelectBar: {
    borderWidth: 1, borderRadius: radius.lg, padding: spacing.sm,
    marginBottom: spacing.xs, gap: spacing.xs,
  },
  mode2SelectTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mode2SelectCount: { ...typography.buttonSm },
  mode2SelectHint: { ...typography.caption, flex: 1 },

  // 모드 2 코트 드롭존 박스 (비어있음=드롭존 / 편성 중=draft + 게임 시작)
  mode2CourtBox: {
    borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.sm, gap: spacing.xs, minHeight: 132,
  },
  mode2CourtHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mode2CourtMeta: { ...typography.caption, fontWeight: '700' },
  mode2CourtHint: { ...typography.caption, textAlign: 'center' },
  mode2CourtActions: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  mode2StartBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.lg,
  },
  mode2StartBtnText: { ...typography.buttonSm, color: '#fff', fontWeight: '700' },
  mode2DraftEmpty: {
    flex: 1, minHeight: 44, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  mode2DraftEmptyText: { ...typography.body2 },
  mode2CourtEmptyInner: {
    minHeight: 72, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md,
  },
  mode2CourtEmptyText: { ...typography.caption, textAlign: 'center', lineHeight: 18 },

  // ─── 모드 2 자유 캔버스 자석판 ───
  canvas: { flex: 1, position: 'relative', overflow: 'hidden' },
  magnetTag: {
    position: 'absolute', left: 0, top: 0,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 9, paddingVertical: 9, borderWidth: 2, borderRadius: radius.md,
    ...(Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none' } as any) : {
      shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
    }),
  },
  magnetSkill: { width: 24, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  magnetSkillCompact: { width: 20, height: 20, borderRadius: 4 },
  magnetSkillBig: { width: 20, height: 20, borderRadius: 5 },
  magnetSkillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  magnetName: { ...typography.body2, flex: 1, fontWeight: '700' },
  magnetNameCompact: { fontSize: 14, lineHeight: 17 },
  magnetNameBig: { fontSize: 15, lineHeight: 18 },
  magnetGames: { minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8, alignItems: 'center' },
  magnetGamesTiny: { fontSize: 10, fontWeight: '800', minWidth: 9, textAlign: 'right' },
  magnetGamesText: { ...typography.caption, fontWeight: '700' },
  // 모드 2 상단 툴바: 검색/필터 + 정렬
  mode2Toolbar: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.smd, paddingTop: spacing.sm },
  mode2TidyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 9, borderWidth: 1, borderRadius: radius.lg },
  mode2TidyText: { ...typography.buttonSm, fontWeight: '700' },
  // 코트 4칸 슬롯 틀
  canvasSlots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  canvasSlot: { flexDirection: 'row', alignItems: 'center', gap: 5, width: '47%', minHeight: 34, paddingHorizontal: 7, paddingVertical: 5, borderWidth: 1.5, borderRadius: radius.md },
  slotSkill: { width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  slotSkillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  slotName: { ...typography.caption, flex: 1, fontWeight: '700' },
  slotEmpty: { ...typography.body2, flex: 1, textAlign: 'center', fontWeight: '700' },
  canvasZoneStart: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 7, paddingVertical: 8, borderRadius: radius.md },
  canvasZoneStartText: { ...typography.buttonSm, color: '#fff', fontWeight: '800' },
  // ── 모드 2: 코트 줄 / 대기 게임 줄 / 명단 3단 ──
  m2Wrap: { flex: 1 },
  // 일번 배치: 코트 위(가로) / 게임판 가운데(세로) / 대기 오른쪽
  m2CourtTopRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.smd, paddingTop: spacing.sm },
  m2CourtTop: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 10, borderWidth: 2, borderRadius: radius.md },
  m2CourtCard: { flex: 1, minWidth: 0, borderWidth: 2, borderRadius: radius.md, padding: spacing.sm },
  m2Body: { flex: 1, flexDirection: 'row', paddingTop: spacing.xs },
  // flex:1 + minWidth:0 — 세로 스크롤. 대기(m2RightWidth)가 넓어지면 게임판이 자동 축소된다
  // (세로 스크롤은 가로폭을 강제하지 않아 flex 축소가 정상 동작 → 넘침 없음).
  m2Center: { flex: 1, minWidth: 0, paddingLeft: spacing.smd },
  m2CenterScroll: { paddingRight: spacing.smd, paddingBottom: spacing.xl },
  m2PlayColHead: { ...typography.caption, fontWeight: '800', marginBottom: 2 },
  m2PoolRight: { width: 430, borderLeftWidth: 1, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  m2PoolSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  m2PoolSearch: { flex: 1, minWidth: 0, height: 30, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, ...typography.caption },
  m2PoolSearchClear: { marginLeft: -28, marginRight: 16, padding: 2 },
  m2GChip: { paddingHorizontal: 8, height: 30, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  m2GChipT: { ...typography.caption, fontWeight: '800' },
  m2SkChip: { minWidth: 28, height: 26, paddingHorizontal: 5, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  m2Divider: { width: 16, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  m2DividerBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginVertical: 6, opacity: 0.7 },
  // (이전 2단 스타일 — 일부 미사용)
  m2Board: { flex: 1, flexDirection: 'row' },
  m2Left: { flex: 1, paddingLeft: spacing.smd, paddingTop: spacing.sm },
  m2LeftScroll: { paddingRight: spacing.smd, paddingBottom: spacing.xl },
  m2Right: { width: 340, borderLeftWidth: 1, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  m2PanelTitle: { ...typography.body2, fontWeight: '800', marginBottom: 8 },
  m2SelectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, marginBottom: 8 },
  m2SelectBarT: { ...typography.body2, color: '#fff', fontWeight: '800', flex: 1 },
  m2SelectCancel: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.25)' },
  m2SelectCancelT: { ...typography.buttonSm, color: '#fff', fontWeight: '800' },
  m2CourtGrid: { gap: spacing.sm, paddingBottom: spacing.xl },
  m2Court: { width: '100%', minWidth: 0, borderWidth: 2, borderRadius: radius.lg, padding: spacing.sm },
  m2CourtHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  m2CourtName: { ...typography.body2, fontWeight: '800', flexShrink: 1 },
  m2CourtState: { ...typography.caption, fontWeight: '800' },
  m2CourtChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  m2Chip: { paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderRadius: radius.sm },
  m2ChipText: { ...typography.caption, fontWeight: '700' },
  m2EndBtn: { marginTop: 6, paddingVertical: 5, borderWidth: 1, borderRadius: radius.sm, alignItems: 'center' },
  m2EndBtnText: { ...typography.caption, fontWeight: '700' },
  m2CourtEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md, marginTop: 2 },
  m2CourtEmptyT: { ...typography.caption, fontWeight: '700' },
  m2QueueRow: { paddingHorizontal: spacing.smd, paddingTop: spacing.sm },
  m2QueueLabel: { ...typography.caption, fontWeight: '800', marginBottom: 4 },
  m2QueueScroll: { gap: spacing.sm, paddingRight: spacing.md, alignItems: 'flex-start' },
  m2QCard: { width: 150, borderWidth: 2, borderRadius: radius.md, padding: 7, ...(Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none' } as any) : {}) },
  m2QCardHint: { ...typography.caption, fontWeight: '800', marginBottom: 4 },
  m2QCardNames: { gap: 3 },
  m2QName: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  m2QSkill: { width: 18, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  m2QSkillT: { color: '#fff', fontSize: 10, fontWeight: '700' },
  m2QNameT: { ...typography.caption, flex: 1, fontWeight: '700' },
  m2Composer: { width: 168, borderWidth: 2, borderRadius: radius.md, padding: 7 },
  m2ComposerHint: { ...typography.caption, fontWeight: '700', marginBottom: 5 },
  m2ComposerSlots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  m2CSlot: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '47%', minHeight: 30, paddingHorizontal: 5, paddingVertical: 3, borderWidth: 1.5, borderRadius: radius.sm },
  m2Bench: { flex: 1, position: 'relative', marginTop: spacing.sm },
  // 묶음 색 테두리(4명이면 강조)
  m2Group: { position: 'absolute', borderWidth: 2.5, borderRadius: radius.lg, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 1 },
  m2GroupTag: { ...typography.caption, fontWeight: '800' },
  // ── 모드2 게임판(번호 칸) + 풀 ──
  m2Scroll: { paddingHorizontal: spacing.smd, paddingBottom: spacing.xl },
  m2SectionLabel: { ...typography.caption, fontWeight: '800', marginBottom: 6 },
  m2GameGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 다음 게임: 4개씩 세로 컬럼(여러 컬럼 가로로)
  m2GameCols: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  m2GameCol: { flex: 1, minWidth: 0, gap: spacing.sm },
  gameFrame: { borderWidth: 2, borderRadius: radius.md, padding: 7 },
  gameFrameHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  gameFrameNoWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  gameNoBadge: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  gameNoBadgeT: { color: '#fff', fontSize: 12, fontWeight: '900' },
  gameFrameNo: { ...typography.body2, fontWeight: '800' },
  gameFrameCount: { ...typography.caption, fontWeight: '800' },
  gameDelBtn: { padding: 3, marginLeft: 4, borderRadius: radius.sm },
  gameOrderBtn: { paddingHorizontal: 3, paddingVertical: 1 },
  gameOrderT: { fontSize: 11, fontWeight: '900', lineHeight: 13 },
  m2LeftHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 8 },
  m2CmdWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 34, borderWidth: 1.5, borderRadius: radius.md },
  m2CmdInput: { flex: 1, minWidth: 0, ...typography.body2 },
  m2CmdBtn: { paddingHorizontal: 9, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  m2CmdBtnT: { ...typography.caption, fontWeight: '800' },
  m2CmdToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderWidth: 1.5, borderRadius: radius.md },
  m2CmdToggleT: { ...typography.caption, fontWeight: '800' },
  m2AutoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1.5, borderRadius: radius.lg },
  m2AutoBtnT: { ...typography.buttonSm, fontWeight: '800' },
  gameFrameStart: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.md },
  gameFrameStartT: { ...typography.buttonSm, color: '#fff', fontWeight: '800' },
  gameFrameWait: { ...typography.caption, fontWeight: '700' },
  gameFrameSlots: { flexDirection: 'row', gap: 4 },
  gameSlot: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, paddingHorizontal: 6, paddingVertical: 4, borderWidth: 1.5, borderRadius: radius.sm },
  gameSlotEmpty: { flex: 1, minWidth: 0, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.sm },
  poolZone: { width: '100%', padding: spacing.xs, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'transparent', borderRadius: radius.md },
  m2PoolCols: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingBottom: 6 },
  m2PoolCol: { width: 150, gap: 5 },
  poolGap: { height: 34, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md, opacity: 0.4 },
  poolGapSlot: { flex: 1, minWidth: 0, minHeight: 31, borderRadius: radius.sm },
  finWait: { ...typography.caption, fontSize: 11, fontWeight: '700' },
  poolOrder: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  poolOrderT: { ...typography.caption, fontWeight: '800' },
  poolWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  poolTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 5, borderWidth: 2, borderRadius: radius.sm,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', userSelect: 'none' } as any) : {}) },
  poolTagCompact: { gap: 3, paddingHorizontal: 4, paddingVertical: 4 },
  poolTagBig: { gap: 4, paddingHorizontal: 5, paddingVertical: 5 },
  canvasZone: { position: 'absolute', borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.sm },
  canvasZoneHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  canvasZoneName: { ...typography.buttonSm, fontWeight: '700' },
  canvasZoneState: { ...typography.caption },
  canvasZoneNames: { ...typography.caption, marginTop: 4 },
  canvasZoneChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  canvasZoneChip: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: radius.md },
  canvasZoneChipText: { ...typography.caption, fontWeight: '600' },
  canvasZoneHintT: { ...typography.caption, marginTop: 3 },
  canvasZoneBtn: { marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1 },
  canvasZoneBtnText: { ...typography.caption, fontWeight: '700' },
  canvasStartBtn: { position: 'absolute', height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, zIndex: 20 },
  canvasStartBtnText: { color: '#fff', ...typography.buttonSm, fontWeight: '700' },

  poolTabs: {
    flexDirection: 'row', alignSelf: 'flex-start',
    padding: 3, borderRadius: radius.lg, borderWidth: 1,
    marginBottom: spacing.sm, gap: 3,
  },
  poolTab: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    minWidth: 52,
  },
  poolTabActive: {
    ...(Platform.OS === 'web' ? {} : {
      shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
    }),
  },
  poolTabText: { ...typography.buttonSm },

  // 편성 상태 배지(전체 보기) — 카드 좌상단에 살짝 걸쳐 떠 있는 작은 필 라벨.
  allPoolBadgeOverlay: { position: 'absolute', top: -7, left: spacing.sm, zIndex: 2 },
  statusBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 1,
    borderRadius: radius.sm, borderWidth: 1, borderColor: palette.white,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },

  // ─── 방금 나온(recent) 보기 ───
  // 누적 카드 목록 — 최신 묶음이 위. 카드는 다음 게임 큐 카드처럼 surface 위에
  // 살짝 떠 있고, 헤더(상대 시간 + 이 4명 편성) + 4개 칩 그리드로 구성.
  recentList: { gap: spacing.sm },
  recentCard: {
    borderRadius: radius.card, borderWidth: 1, padding: spacing.sm, gap: spacing.xs,
  },
  recentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  recentTimeDot: { width: 7, height: 7, borderRadius: 4 },
  recentTime: { fontSize: 13, fontWeight: '800' },
  recentSub: { fontSize: 11, fontWeight: '600' },
  recentStageBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 28,
  },
  recentStageBtnText: { color: palette.white, fontSize: 12, fontWeight: '800' },
  // 4 칩이 2열로 깔리는 그리드(폰) — 측정 없이 48% 고정. 좁아도 2열이 안정적.
  recentChipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  recentChip: {
    width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 6,
    minHeight: 36,
  },
  recentChipSkill: {
    width: 18, height: 18, borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  recentChipSkillText: { fontSize: 10, fontWeight: '900' },
  recentChipName: { flexShrink: 1, fontSize: 12.5, fontWeight: '700' },
  recentStatusTag: {
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.sm,
  },
  recentStatusTagText: { fontSize: 9, fontWeight: '800' },

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
  // FALLBACK width only — the real column count is responsive: poolCellStyle
  // overrides this with an exact px width derived from the MEASURED grid width
  // (poolColumnsFor → 1 col narrow phone, 2 col tablet portrait, 3–4 col wide
  // tablet-landscape/desktop). This 48.5% applies for the first frame before
  // onLayout fires, keeping the old 2-col look as a graceful default.
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
  queueNumSm: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nextTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  nextTagText: { fontSize: 11, fontWeight: '800' },
  // Game-type TAG pill (남복/여복/혼복) for queue cards — soft tinted bg so the
  // composition is scannable at a glance.
  queueTypeTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  queueTypeTagText: { fontSize: 11, fontWeight: '800' },
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
  // Gender marker → shared <GenderMarker> vector icon (robust, auto-centered).
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
  queueNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  queueNumText: { fontSize: 13, fontWeight: '900' },

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
  gameChipName: { fontSize: 13.5, fontWeight: '700', flexShrink: 1, lineHeight: 18 },
  // Gender marker → shared <GenderMarker> vector icon (robust, auto-centered).
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
  // Per-court elapsed timer pill ("⏱ N분 진행 중"). Sits left of the 게임 중 badge.
  elapsedBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill,
    flexShrink: 1, minWidth: 0,
  },
  elapsedBadgeText: { fontSize: 11, fontWeight: '700' },

  courtActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
  courtActionText: { ...typography.buttonSm },
  courtClearLink: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs, marginTop: spacing.xs },
  courtClearLinkText: { ...typography.caption, textDecorationLine: 'underline' },

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
  // 성별 selector chip: vector marker + 남/여 label (auto width so both fit).
  genderChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    height: 38, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5,
  },
  genderChipLabel: { fontSize: 15, fontWeight: '800' },
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
  // Gender marker → shared <GenderMarker> vector icon (robust, auto-centered).
  matchupCount: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  matchupCountText: { fontSize: 12, fontWeight: '800' },
  // 헤더: 이름 + 게스트 배지
  matchupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  guestBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  guestBadgeText: { fontSize: 11, fontWeight: '800' },
  // 운영자 액션 행: [이름·급수 수정][체크아웃]
  matchupActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  actionFlex: { flex: 1, marginTop: 0 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1.5,
  },
  // 운영자 인라인 이름·급수 수정 폼
  editForm: {
    marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: 2,
  },
  skillChipWide: {
    height: 38, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  // 운영자 체크아웃 버튼 (danger, outline)
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.md, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1.5,
  },
  checkoutBtnText: { ...typography.button },
  // 교체 시트의 '이 자리에서 빼기' 버튼 (danger, outline)
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginBottom: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1.5,
  },
  removeBtnText: { ...typography.buttonSm },

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

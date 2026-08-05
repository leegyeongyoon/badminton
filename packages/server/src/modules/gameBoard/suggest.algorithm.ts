/**
 * Suggestion algorithm for badminton game-board auto-composition.
 *
 * Given N players and M courts (4 players per court for doubles),
 * generates a fair round-robin schedule. Internalized from the former
 * (now removed) rotation module, used by gameBoard.suggestNextFoursome.
 *
 * Key rules:
 * 1. Fairness: all players play approximately equal number of games AND those
 *    who have WAITED longer (early arrival / idle since last game) rise.
 * 2. Variety: minimize repeated partner/opponent pairings (recency-weighted) so
 *    the same cluster does not keep playing together (anti-routine rotation).
 * 3. "먹고치기": if N = M*4, no one sits out
 * 4. N > M*4: highest-priority (fewest-games + longest-wait) players prioritized
 *
 * Mode-based single-foursome picking (the 5 운영자 modes) is a UNIFIED scoring
 * function over candidate groups of 4 — see scoreGroup / selectFoursomeByMode.
 * Every mode keeps the fairness + variety baseline; the mode only adds a flavor
 * term on top. The 5 modes form a SKILL-SPREAD SPECTRUM (same-level → middle →
 * big-gap): fair (no skill flavor) · similar (tightest spread) · balanced
 * (moderate, even 2v2) · competitive (폴라라이즈 2강 2약) · fresh (extra variety).
 */

export interface RotationInput {
  playerIds: string[];
  courtIds: string[];
  targetRounds?: number;
  /**
   * Optional per-player baseline of games already played, used to seed fairness
   * so players with fewer prior games are prioritized. Backward compatible.
   */
  initialGamesCount?: Record<string, number>;
}

export interface RotationSlotData {
  round: number;       // 1-based
  courtIndex: number;  // 0-based
  courtId: string;
  playerIds: string[]; // 4 players
}

export interface RotationOutput {
  slots: RotationSlotData[];
  totalRounds: number;
}

export function generateRotation(input: RotationInput): RotationOutput {
  const { playerIds, courtIds } = input;
  const numPlayers = playerIds.length;
  const numCourts = courtIds.length;
  const playersPerGame = 4;
  const playersPerRound = numCourts * playersPerGame;

  // Calculate default rounds: enough so everyone plays at least the same # of games
  const defaultRounds = numPlayers <= playersPerRound
    ? Math.max(3, Math.ceil(numPlayers / playersPerGame))
    : Math.max(3, Math.ceil((numPlayers * 3) / playersPerRound));
  const totalRounds = input.targetRounds || defaultRounds;

  // Track stats for fairness
  const gamesCount = new Map<string, number>();
  const sitOutCount = new Map<string, number>();
  const pairHistory = new Map<string, number>(); // "p1,p2" => count

  for (const pid of playerIds) {
    gamesCount.set(pid, input.initialGamesCount?.[pid] ?? 0);
    sitOutCount.set(pid, 0);
  }

  const slots: RotationSlotData[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    // Select players for this round
    const selected = selectPlayersForRound(
      playerIds,
      playersPerRound,
      gamesCount,
      sitOutCount,
    );

    const sittingOut = playerIds.filter((p) => !selected.includes(p));
    for (const pid of sittingOut) {
      sitOutCount.set(pid, (sitOutCount.get(pid) || 0) + 1);
    }

    // Form groups of 4 for each court
    const groups = formGroups(selected, numCourts, playersPerGame, pairHistory);

    for (let ci = 0; ci < numCourts; ci++) {
      const group = groups[ci];
      if (!group || group.length < playersPerGame) continue;

      slots.push({
        round,
        courtIndex: ci,
        courtId: courtIds[ci],
        playerIds: group,
      });

      // Update stats
      for (const pid of group) {
        gamesCount.set(pid, (gamesCount.get(pid) || 0) + 1);
      }

      // Update pair history
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = [group[i], group[j]].sort().join(',');
          pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
        }
      }
    }
  }

  return { slots, totalRounds };
}

// ─── Unified mode-based foursome selection ─────────────────────────────────
// A single scoring function picks ONE foursome (4 players) for ALL 6 modes:
//
//   score(group) = wFair·fairness(group) + wVariety·variety(group)
//                  + wMode·modeTerm(group, mode)      (lower = better)
//
// • fairness(group): sum of per-player priorityCost = f(gamesPlayedToday,
//   waitSeconds). Fewer games + longer wait ⇒ lower cost ⇒ better. So an early
//   arrival who's been idle and a person with few games both rise; a player who
//   JUST finished a game (short wait) sinks. Applied in EVERY mode.
// • variety(group): sum of recency-weighted pair-history among the 6 pairs.
//   Recent pairings weigh more than old ones. Lower ⇒ better. Meaningful in
//   ALL modes (largest weight in 'fresh') so partners ROTATE.
// • modeTerm: the per-mode flavor ON TOP of fairness+variety. The 5 modes form a
//   skill-spread spectrum (tight → moderate → polarized):
//     fair        → 0                  (pure fairness + variety, no skill flavor)
//     similar     → skill spread (max−min) of the four — TIGHTEST band
//     balanced    → best 2v2 imbalance — MODERATE, two evenly-matched teams
//     competitive → −gap(top2 mean, bottom2 mean) — POLARIZED 2강 2약 (빡센)
//     fresh       → extra variety (more pair-history penalty)

export type SuggestMode =
  | 'fair'
  | 'similar'
  | 'balanced'
  | 'competitive'
  | 'fresh';

export interface ModePlayer {
  id: string;
  skill: number; // S=7 … F=1, null→4 (mapped by the caller)
  games: number; // gamesPlayedToday (fewer = preferred)
  gender: 'M' | 'F' | null;
  /** Seconds the player has been waiting = now − max(checkedInAt, lastGameAt). */
  waitSeconds: number;
  /**
   * 체류 시간(초) = now − 체크인 시각. '적게 친'을 체크인 시간 대비로 판단하기 위한 값:
   * 기대 게임수 = timePresentSeconds / GAME_CYCLE_SECONDS, 결손 = 기대 − 실제. 방금 온
   * 사람이 게임 수 적은 건 당연(결손 0)하고, 오래 있었는데 못 친 사람이 최우선이 된다.
   */
  timePresentSeconds: number;
  /** 이번 정모에서 이 사람이 친 '혼복' 게임 수(성별 순환 anti-fixation용). */
  mixedGames: number;
  /** 이번 정모에서 이 사람이 친 '동성복(남복/여복)' 게임 수. */
  sameGames: number;
}

export interface ModeResult {
  playerIds: string[];
  /**
   * Reserved fallback signal (no mode currently triggers it; kept so the caller
   * can stay generic if a future mode needs a hard constraint).
   */
  fellBack?: boolean;
}

// ── Tunables ────────────────────────────────────────────────────────────────
// Reference window used to normalize wait time into ~[0,1] "game-equivalent"
// units so it can trade off against gamesPlayed in the priority cost. 15 min of
// waiting ≈ the worth of having played one fewer game.
const WAIT_REF_SECONDS = 15 * 60;
// Recency-decay half-life for pair history (older shared games count less).
const PAIR_RECENCY_HALFLIFE_SECONDS = 45 * 60;

// 성별 보정(실효 급수) — 같은 letter라도 실제 전력이 다르다. 배드민턴 관례상 여자 급수는
// 남자보다 후한(높은) 편이라, 매칭 균형을 맞추려면 여자 급수를 남자 기준으로 몇 단계 낮춰
// '실효 급수'로 환산해 비교한다. 예) 오프셋 1 → 여자 B(5)=남자 C(4), 여자 A(6)=남자 B(5);
// 오프셋 2 → 여자 B=남자 D. 등급이 올라가도 같은 폭으로 함께 올라간다(선형). 여기 한 값만
// 바꾸면 전 등급에 반영된다. (M/미설정은 보정 없음, F만 하향 환산.)
const GENDER_SKILL_OFFSET_FEMALE = -1;

// 공평 결손 — 기대 게임 1판당 걸리는 주기(초). 체류 시간을 '기대 게임 수'로 환산할 때 쓴다
// (게임 ~11~13분). 체류시간/주기 = 기대 게임 수, 결손 = 기대 − 실제.
const GAME_CYCLE_SECONDS = 13 * 60;
// 결손이 무한정 커지지 않게 상한(아주 오래 있었는데 못 친 경우도 이 이상은 안 튐).
const FAIRSHARE_CAP = 8;
// 마지막 게임 이후 유휴 시간 보너스 상한(결손이 주 신호, 유휴는 동급 결손자 사이 tie-breaker).
const WAIT_BONUS_CAP = 1;

// 타입 편중 방지 — 잘/못 치는 사람 누구도 혼복/동성복 한쪽에 갇히지 않게, 부족한 타입을
// 주는 그룹을 선호(soft). 급수·공평엔 양보한다.
const TYPE_VARIETY_WEIGHT = 0.6;

// ── Controlled tie-breaking randomness (anti-determinism) ────────────────────
// The unified scoring is otherwise fully deterministic, so when many players are
// tied on fairness (e.g. everyone has 0 games / similar wait) the SAME top-scored
// foursome wins every call. We inject a small random jitter into each player's
// priority so equally-owed players ROTATE across calls — while a real ≥1-game
// difference still dominates (a 5-game player never out-jitters a 0-game player).
//
// JITTER_GAME_EQUIV is the half-amplitude in game-equivalent units. At 0.35 the
// jitter spans ~[-0.35, +0.35] (full span 0.7 < 1 game), so two players whose
// priorityCost differs by ≥1 (a whole game / ~15 min wait) keep their order with
// certainty, but a 0-vs-0 tie shuffles freely. Mode terms (skill band, 2강2약,
// even teams) are scored WITHOUT jitter, so each call still honors the mode — it
// just picks a different equally-fair foursome.
const JITTER_GAME_EQUIV = 0.35;
// Owed-band width (game-equivalents): when widening the candidate set we keep
// every player within this much of the most-owed player's jittered priority, so
// clearly-more-owed players are always in, clearly-less-owed always out. ~1.5
// games lets a couple of game-bands of owed players into the shuffled pool.
const OWED_BAND_GAME_EQUIV = 1.5;

// Uniform jitter in [-JITTER_GAME_EQUIV, +JITTER_GAME_EQUIV]. Math.random() is
// fine in normal server Node code (the no-random rule is workflow-scripts only).
function priorityJitter(): number {
  return (Math.random() * 2 - 1) * JITTER_GAME_EQUIV;
}

// In-place Fisher–Yates shuffle (returns the same array for convenience).
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Per-mode scoring weights. wFair/wVariety form the universal baseline (present
// in EVERY mode); wMode scales that mode's flavor term. Values are tuned so the
// baseline always pulls from owed/waiting players and rotates partners, while
// the mode term still visibly changes WHO among them is chosen.
interface ModeWeights {
  wFair: number;
  wVariety: number;
  wMode: number;
}
const MODE_WEIGHTS: Record<SuggestMode, ModeWeights> = {
  // pure fairness + variety (no flavor)
  fair: { wFair: 1.0, wVariety: 1.0, wMode: 0 },
  // skill-similar: tight skill spread, but still owed/rotating players.
  // wMode is sized so the skill flavor can overcome a moderate fairness gap
  // (per-player fairness cost spans ~[-2,2]) while fairness still pulls from the
  // owed pool and variety still rotates partners.
  similar: { wFair: 1.0, wVariety: 1.0, wMode: 1.5 },
  // even 2v2 split (moderate spread, two evenly-matched teams)
  balanced: { wFair: 1.0, wVariety: 1.0, wMode: 1.5 },
  // 2강 2약 polarized gap (빡센 게임). modeTerm is −gap so a clearly bimodal four
  // (strong pair + weak pair) wins; sized to overcome a moderate fairness gap.
  competitive: { wFair: 1.0, wVariety: 1.0, wMode: 1.5 },
  // anti-routine: variety dominates
  fresh: { wFair: 1.0, wVariety: 3.0, wMode: 0 },
};

// pairKey: order-independent key for two player ids, matching computeComposition.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Per-player priority COST (lower = higher priority = picked first).
 *
 *   cost = games − fairShare − waitBonus
 *
 * - fairShare = min(FAIRSHARE_CAP, 체류시간/게임주기) = "지금까지 있었으면 이 정도는
 *   쳤어야 하는" 기대 게임 수. games − fairShare = 결손(음수일수록 더 owed). 이렇게 해서
 *   '적게 친'을 체크인 시간 대비로 본다: 방금 온 0게임(fairShare≈0)은 안 튀고, 오래 있었는데
 *   0게임(fairShare 큼)은 최우선. 방금 친 사람은 games가 fairShare에 근접/초과 → 후순위.
 * - waitBonus = min(WAIT_BONUS_CAP, 유휴시간/WAIT_REF): 마지막 게임 이후 오래 쉰 사람을
 *   동급 결손자 사이에서 살짝 앞세우는 tie-breaker(막 끝낸 사람은 0).
 */
export function priorityCost(p: ModePlayer): number {
  const fairShare = Math.min(FAIRSHARE_CAP, p.timePresentSeconds / GAME_CYCLE_SECONDS);
  const waitBonus = Math.min(WAIT_BONUS_CAP, p.waitSeconds / WAIT_REF_SECONDS);
  return p.games - fairShare - waitBonus;
}

// fairness(group): sum of per-player JITTERED priorityCost. Lower ⇒ the four are
// more "owed" a game (few games and/or long waits) ⇒ better. `jitterById` maps a
// player id → priorityCost + a small (<1 game) random jitter computed ONCE per
// call, so the combo search itself ROTATES among equally-owed ties across calls
// while a real ≥1-game gap still dominates. Falls back to raw priorityCost if a
// player has no jitter entry (defensive; the caller always supplies one).
function fairnessCost(group: ModePlayer[], jitterById: Map<string, number>): number {
  let c = 0;
  for (const p of group) c += jitterById.get(p.id) ?? priorityCost(p);
  return c;
}

// variety(group): recency-weighted shared-history among the 6 pairs of the four.
// `pairWeight` maps a pairKey → already-decayed weight (recent games weigh more).
// Lower ⇒ these four have rarely/not-recently played together ⇒ fresher.
function varietyCost(group: ModePlayer[], pairWeight: Record<string, number>): number {
  let c = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      c += pairWeight[pairKey(group[i].id, group[j].id)] ?? 0;
    }
  }
  return c;
}

// 성별 보정 실효 급수 — 여자는 genderOffsetFemale 만큼 낮춰 남자와 같은 척도로.
// 급수 밸런싱(비슷한/균형/빡센)은 이 실효 급수로 비교해 남녀 섞인 게임도 실제 전력이 맞도록 한다.
function effectiveSkill(p: ModePlayer, genderOffsetFemale: number): number {
  return p.skill + (p.gender === 'F' ? genderOffsetFemale : 0);
}

// modeTerm(group, mode): the mode-specific flavor cost (lower = better). The
// fairness + variety baseline is added by scoreGroup, NOT here.
function modeTerm(group: ModePlayer[], mode: SuggestMode, genderOffsetFemale: number): number {
  const skills = group.map((p) => effectiveSkill(p, genderOffsetFemale));
  switch (mode) {
    case 'similar': {
      // Prefer a tight skill spread.
      return Math.max(...skills) - Math.min(...skills);
    }
    case 'competitive': {
      // 빡센 게임 = 2강 2약. Reward a POLARIZED/bimodal four whose sorted skills
      // split into a clearly STRONG pair + clearly WEAK pair. Sort the four and
      // take the gap between the top-2 mean and bottom-2 mean; return it NEGATED
      // so a BIGGER gap costs LESS. e.g. sorted [F,E,A,S] → top2 (A,S)=6.5,
      // bottom2 (F,E)=1.5, gap=5 beats [B,A,S,S] (top2 7, bottom2 5.5, gap 1.5).
      const s = [...skills].sort((a, b) => a - b);
      if (s.length < 4) return 0;
      const bottom2 = (s[0] + s[1]) / 2;
      const top2 = (s[2] + s[3]) / 2;
      return -(top2 - bottom2);
    }
    case 'balanced': {
      // 균형 접전 = the MIDDLE of the spectrum: a moderate, even mix. Prefer the
      // four that split into the most even 2v2. For a sorted four the tightest
      // split pairs the ends together: (s0+s3) vs (s1+s2).
      const s = [...skills].sort((a, b) => a - b);
      if (s.length < 4) return 0;
      return Math.abs(s[0] + s[3] - (s[1] + s[2]));
    }
    case 'fresh':
    case 'fair':
    default:
      return 0;
  }
}

// 소프트 동성 우선(유두리) — 남복(4남)/여복(4여)을 '살짝' 선호하되 급수·공평에 양보.
// genderMixCost: 순수 동성=0, 섞일수록 min(남수,여수)만큼 비용(3:1→1, 2:2→2). 성별 미설정은
// 어느 쪽으로도 안 세어 관대하게 둔다. 가중치(SAME_GENDER_WEIGHT)가 작아, 급수/공평 차가
// 조금만 있어도 바로 혼복으로 양보한다 → 남복/여복 성향 + 혼복도 충분히 섞임.
const SAME_GENDER_WEIGHT = 0.5;
function genderMixCost(group: ModePlayer[]): number {
  let m = 0;
  let f = 0;
  for (const p of group) {
    if (p.gender === 'M') m++;
    else if (p.gender === 'F') f++;
  }
  return Math.min(m, f);
}

// 그룹 타입 — 남녀 각각 1명 이상이면 '혼복', 아니면 '동성복(남복/여복)'.
function groupType(group: ModePlayer[]): 'mixed' | 'same' {
  let m = 0;
  let f = 0;
  for (const p of group) {
    if (p.gender === 'M') m++;
    else if (p.gender === 'F') f++;
  }
  return m >= 1 && f >= 1 ? 'mixed' : 'same';
}

// 타입 편중 비용 — 이 그룹의 타입(혼복/동성복)을 '이미 많이 친' 사람이 많을수록 비용↑,
// 그 타입이 '부족한' 사람이 많을수록 비용↓(음수). 부족한 타입을 주도록 유도해 잘/못 치는
// 사람 누구도 한 타입에 갇히지 않게 한다(강자·약자 모두 혼복 순환에 포함). w_type로 soft.
function typeVarietyCost(group: ModePlayer[]): number {
  const t = groupType(group);
  let c = 0;
  for (const p of group) {
    c += t === 'mixed' ? p.mixedGames - p.sameGames : p.sameGames - p.mixedGames;
  }
  return c;
}

// 운영자 조율값 — 운영판에서 강도를 바꿀 수 있는 값들. 미지정 항목은 모듈 기본 상수 사용.
export interface SuggestTuning {
  genderOffsetFemale: number; // 여자 급수 보정폭(음수·0). 0=보정끔
  sameGenderWeight: number;   // 동성 복식(남복/여복) 선호 강도(0=끔)
  typeVarietyWeight: number;  // 타입 순환(혼복 포함) 강도(0=끔)
}
export function resolveTuning(t?: Partial<SuggestTuning>): SuggestTuning {
  return {
    genderOffsetFemale: t?.genderOffsetFemale ?? GENDER_SKILL_OFFSET_FEMALE,
    sameGenderWeight: t?.sameGenderWeight ?? SAME_GENDER_WEIGHT,
    typeVarietyWeight: t?.typeVarietyWeight ?? TYPE_VARIETY_WEIGHT,
  };
}

// Unified score for a group of 4 (lower = better). `jitterById` carries the
// per-player jittered fairness cost (priorityCost + sub-one-game jitter) so the
// combo search rotates equally-owed players across calls without breaking a real
// fairness gap; mode/variety terms stay un-jittered so each call still honors
// the mode (tight band / 2강2약 / even teams) and rotates partners.
function scoreGroup(
  group: ModePlayer[],
  mode: SuggestMode,
  pairWeight: Record<string, number>,
  jitterById: Map<string, number>,
  tuning: SuggestTuning,
): number {
  const w = MODE_WEIGHTS[mode];
  return (
    w.wFair * fairnessCost(group, jitterById) +
    w.wVariety * varietyCost(group, pairWeight) +
    w.wMode * modeTerm(group, mode, tuning.genderOffsetFemale) +
    // 타입 순환 — 부족한 타입(혼복/동성복)을 주도록 유도(아무도 한 타입에 갇히지 않게).
    tuning.typeVarietyWeight * typeVarietyCost(group) +
    // 소프트 동성 우선 — 모든 모드에 얹는 약한 성향(급수/공평이 우선, 혼복 유두리 유지).
    tuning.sameGenderWeight * genderMixCost(group)
  );
}

/**
 * selectFoursomeByMode — pick `size` (default 4) players from `pool` using the
 * unified scoring function for the given mode.
 *
 * Candidate generation (efficient for ~40): rank the pool by a JITTERED
 * per-player priorityCost (fairness: fewest games + longest wait first, with a
 * small sub-one-game random jitter that only reorders TIES / near-ties). Keep
 * every player within an "owed band" of the most-owed (so clearly-more-owed are
 * always in, clearly-less-owed always out), SHUFFLE that band, and cap at top-N.
 * Then bounded combo-search over groups of 4 among them, scoring each group and
 * keeping the best. This keeps fairness (only owed/waiting players are
 * considered) while letting the jitter + shuffle + mode flavor decide WHICH of
 * the equally-owed play and ROTATE partners — so REPEATED calls differ.
 *
 * `pairWeight`: recency-weighted shared-history per pairKey (recent games weigh
 * more). Used by the variety baseline in every mode.
 *
 * Read-only. Falls back gracefully when the pool is short (returns what's there).
 */
export function selectFoursomeByMode(
  pool: ModePlayer[],
  mode: SuggestMode,
  pairWeight: Record<string, number>,
  size = 4,
  topN = 20,
  tuning?: Partial<SuggestTuning>,
): ModeResult {
  const tune = resolveTuning(tuning);
  if (pool.length <= size) {
    // Whole pool plays.
    return { playerIds: pool.map((p) => p.id) };
  }

  // Jittered fairness key per player: priorityCost + small (<1 game) random
  // jitter. The jitter only matters when two players are within ~1 game of each
  // other; a clearly more-owed player (≥1 fewer game / ≥15 min more wait) still
  // sorts ahead. Compute ONCE per call so the band cut + sort agree.
  const jitterById = new Map<string, number>();
  for (const p of pool) jitterById.set(p.id, priorityCost(p) + priorityJitter());
  const key = (p: ModePlayer): number => jitterById.get(p.id) as number;

  // Fairness-first ranking on the jittered key (ties already broken by jitter).
  const ranked = [...pool].sort((a, b) => {
    const d = key(a) - key(b);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable fallback
  });

  // Widen + shuffle the candidate set instead of always taking the same
  // deterministic top-N. Take the OWED BAND: every player whose jittered key is
  // within OWED_BAND_GAME_EQUIV of the most-owed player. This guarantees the 4
  // chosen are still low-games / long-wait (clearly-less-owed players fall
  // outside the band and are never sampled), but the band is then shuffled so a
  // DIFFERENT equally-owed subset feeds the combo search each call.
  const bestKey = key(ranked[0]);
  const band = ranked.filter((p) => key(p) - bestKey <= OWED_BAND_GAME_EQUIV);
  // Always have at least enough to form a group + some rotation room.
  const minBand = Math.min(ranked.length, Math.max(size + 4, 8));
  const banded = band.length >= minBand ? band : ranked.slice(0, minBand);
  shuffleInPlace(banded);
  const candidates = banded.slice(0, Math.min(topN, banded.length));

  // Bounded combo search over C(|candidates|, 4). With topN=20 that's C(20,4)=
  // 4845 groups — cheap. Score each; keep the best (lowest cost).
  let best: ModePlayer[] | null = null;
  let bestScore = Infinity;
  const n = candidates.length;

  if (size === 4 && n >= 4) {
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++) {
            const group = [candidates[a], candidates[b], candidates[c], candidates[d]];
            const s = scoreGroup(group, mode, pairWeight, jitterById, tune);
            if (s < bestScore) {
              bestScore = s;
              best = group;
            }
          }
  } else {
    // size ≠ 4 (rare): just take the highest-priority `size` players (by the
    // jittered key, so still owed-first with tie rotation; band is shuffled).
    best = [...candidates].sort((a, b) => key(a) - key(b)).slice(0, size);
  }

  if (!best) {
    return { playerIds: ranked.slice(0, size).map((p) => p.id) };
  }

  return { playerIds: best.map((p) => p.id) };
}

function selectPlayersForRound(
  allPlayers: string[],
  count: number,
  gamesCount: Map<string, number>,
  sitOutCount: Map<string, number>,
): string[] {
  if (allPlayers.length <= count) {
    return [...allPlayers];
  }

  // Sort by: fewest games first, then most sit-outs first (tie-breaker)
  const sorted = [...allPlayers].sort((a, b) => {
    const gamesDiff = (gamesCount.get(a) || 0) - (gamesCount.get(b) || 0);
    if (gamesDiff !== 0) return gamesDiff;
    return (sitOutCount.get(b) || 0) - (sitOutCount.get(a) || 0);
  });

  return sorted.slice(0, count);
}

function formGroups(
  players: string[],
  numCourts: number,
  groupSize: number,
  pairHistory: Map<string, number>,
): string[][] {
  const totalNeeded = numCourts * groupSize;

  // If not enough players, pad with what we have
  if (players.length < totalNeeded) {
    const groups: string[][] = [];
    let idx = 0;
    for (let c = 0; c < numCourts; c++) {
      const group: string[] = [];
      for (let p = 0; p < groupSize && idx < players.length; p++) {
        group.push(players[idx++]);
      }
      if (group.length === groupSize) {
        groups.push(group);
      }
    }
    return groups;
  }

  // Greedy approach: form groups minimizing pair overlap
  const remaining = [...players];
  const groups: string[][] = [];

  for (let c = 0; c < numCourts; c++) {
    if (remaining.length < groupSize) break;

    const group: string[] = [];

    // Pick first player (random from remaining)
    const firstIdx = Math.floor(Math.random() * remaining.length);
    group.push(remaining.splice(firstIdx, 1)[0]);

    // Pick remaining players to minimize overlap with already-picked
    while (group.length < groupSize && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        let score = 0;
        for (const gp of group) {
          const key = [remaining[i], gp].sort().join(',');
          score += pairHistory.get(key) || 0;
        }
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      group.push(remaining.splice(bestIdx, 1)[0]);
    }

    groups.push(group);
  }

  return groups;
}

// Exported tunables for the service (recency decay) so the caller can build the
// recency-weighted pairWeight map consistently with this module.
export const SUGGEST_TUNABLES = {
  WAIT_REF_SECONDS,
  PAIR_RECENCY_HALFLIFE_SECONDS,
  GENDER_SKILL_OFFSET_FEMALE,
  SAME_GENDER_WEIGHT,
  GAME_CYCLE_SECONDS,
  FAIRSHARE_CAP,
  WAIT_BONUS_CAP,
  TYPE_VARIETY_WEIGHT,
};

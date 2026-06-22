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
 * cost = gamesPlayedToday − waitWorth, where waitWorth grows with wait time
 * (capped). So fewer games ⇒ lower cost, AND longer wait ⇒ lower cost. A player
 * who just finished a game has waitSeconds≈0 ⇒ no wait credit ⇒ higher cost.
 */
export function priorityCost(p: ModePlayer): number {
  // waitWorth is in the same unit as "games": capped at ~2 games of credit so a
  // very long wait can offset up to two extra games played, but not run away.
  const waitWorth = Math.min(2, p.waitSeconds / WAIT_REF_SECONDS);
  return p.games - waitWorth;
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

// modeTerm(group, mode): the mode-specific flavor cost (lower = better). The
// fairness + variety baseline is added by scoreGroup, NOT here.
function modeTerm(group: ModePlayer[], mode: SuggestMode): number {
  const skills = group.map((p) => p.skill);
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
): number {
  const w = MODE_WEIGHTS[mode];
  return (
    w.wFair * fairnessCost(group, jitterById) +
    w.wVariety * varietyCost(group, pairWeight) +
    w.wMode * modeTerm(group, mode)
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
): ModeResult {
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
            const s = scoreGroup(group, mode, pairWeight, jitterById);
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
};

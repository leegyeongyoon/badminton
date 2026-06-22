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
 * Mode-based single-foursome picking (the 6 운영자 modes) is a UNIFIED scoring
 * function over candidate groups of 4 — see scoreGroup / selectFoursomeByMode.
 * Every mode keeps the fairness + variety baseline; the mode only adds a flavor
 * term on top (skill spread / balance / high-skill / gender / extra variety).
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
// • modeTerm: the per-mode flavor ON TOP of fairness+variety.
//     fair        → 0           (pure fairness + variety)
//     similar     → skill spread (max−min) of the four
//     balanced    → best 2v2 skill imbalance
//     competitive → prefer high skill (negative mean skill)
//     mixed       → 0 if 2M+2F else large penalty
//     fresh       → extra variety (more pair-history penalty)

export type SuggestMode =
  | 'fair'
  | 'similar'
  | 'balanced'
  | 'competitive'
  | 'fresh'
  | 'mixed';

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
  /** True when 'mixed' fell back to 'fair' because the pool lacked 2M+2F. */
  fellBack?: boolean;
}

// ── Tunables ────────────────────────────────────────────────────────────────
// Reference window used to normalize wait time into ~[0,1] "game-equivalent"
// units so it can trade off against gamesPlayed in the priority cost. 15 min of
// waiting ≈ the worth of having played one fewer game.
const WAIT_REF_SECONDS = 15 * 60;
// Recency-decay half-life for pair history (older shared games count less).
const PAIR_RECENCY_HALFLIFE_SECONDS = 45 * 60;

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
  // even 2v2 split
  balanced: { wFair: 1.0, wVariety: 1.0, wMode: 1.5 },
  // high-skill bias
  competitive: { wFair: 1.0, wVariety: 1.0, wMode: 1.5 },
  // gender 2M2F (hard-ish constraint via large penalty term in modeTerm)
  mixed: { wFair: 1.0, wVariety: 1.0, wMode: 1.0 },
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

// fairness(group): sum of per-player priorityCost. Lower ⇒ the four are more
// "owed" a game (few games and/or long waits) ⇒ better.
function fairnessCost(group: ModePlayer[]): number {
  let c = 0;
  for (const p of group) c += priorityCost(p);
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
      // Prefer high skill → negative mean skill (so stronger groups cost less).
      const mean = skills.reduce((s, x) => s + x, 0) / group.length;
      return -mean;
    }
    case 'balanced': {
      // Prefer the four that split into the most even 2v2. For a sorted four the
      // tightest split pairs the ends together: (s0+s3) vs (s1+s2).
      const s = [...skills].sort((a, b) => a - b);
      if (s.length < 4) return 0;
      return Math.abs(s[0] + s[3] - (s[1] + s[2]));
    }
    case 'mixed': {
      // Hard-ish: require exactly 2M + 2F. Anything else is heavily penalized so
      // the scorer only ever picks a valid 2M2F group when one exists among the
      // candidates. Among valid groups, keep the two mixed teams balanced.
      const males = group.filter((p) => p.gender === 'M');
      const females = group.filter((p) => p.gender === 'F');
      if (males.length !== 2 || females.length !== 2) return 1000;
      const [m1, m2] = [...males].sort((a, b) => b.skill - a.skill); // strong, weak
      const [f1, f2] = [...females].sort((a, b) => a.skill - b.skill); // weak, strong
      // Team A = strongM+weakF, Team B = weakM+strongF.
      return Math.abs(m1.skill + f1.skill - (m2.skill + f2.skill));
    }
    case 'fresh':
    case 'fair':
    default:
      return 0;
  }
}

// Unified score for a group of 4 (lower = better).
function scoreGroup(
  group: ModePlayer[],
  mode: SuggestMode,
  pairWeight: Record<string, number>,
): number {
  const w = MODE_WEIGHTS[mode];
  return (
    w.wFair * fairnessCost(group) +
    w.wVariety * varietyCost(group, pairWeight) +
    w.wMode * modeTerm(group, mode)
  );
}

/**
 * selectFoursomeByMode — pick `size` (default 4) players from `pool` using the
 * unified scoring function for the given mode.
 *
 * Candidate generation (efficient for ~40): rank the pool by per-player
 * priorityCost (fairness: fewest games + longest wait first), take the top-N
 * (default 20), then bounded combo-search over groups of 4 among them, scoring
 * each group and keeping the best. This keeps fairness (only owed/waiting
 * players are considered) while letting variety + the mode flavor decide WHO
 * among them plays and ROTATES partners.
 *
 * `pairWeight`: recency-weighted shared-history per pairKey (recent games weigh
 * more). Used by the variety baseline in every mode.
 *
 * Read-only. Falls back gracefully when the pool is short (returns what's there).
 * 'mixed' signals fellBack when no 2M+2F group exists among the candidates.
 */
export function selectFoursomeByMode(
  pool: ModePlayer[],
  mode: SuggestMode,
  pairWeight: Record<string, number>,
  size = 4,
  topN = 20,
): ModeResult {
  if (pool.length <= size) {
    // Whole pool plays; for 'mixed', honor the 2M+2F requirement.
    if (mode === 'mixed') {
      const males = pool.filter((p) => p.gender === 'M').length;
      const females = pool.filter((p) => p.gender === 'F').length;
      if (males < 2 || females < 2) return { playerIds: [], fellBack: true };
    }
    return { playerIds: pool.map((p) => p.id) };
  }

  // Fairness-first candidate pool: the top-N most-owed/longest-waiting players.
  const ranked = [...pool].sort((a, b) => {
    const d = priorityCost(a) - priorityCost(b);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // deterministic tiebreak
  });
  const candidates = ranked.slice(0, Math.min(topN, ranked.length));

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
            const s = scoreGroup(group, mode, pairWeight);
            if (s < bestScore) {
              bestScore = s;
              best = group;
            }
          }
  } else {
    // size ≠ 4 (rare): just take the highest-priority `size` players.
    best = candidates.slice(0, size);
  }

  if (!best) {
    return { playerIds: ranked.slice(0, size).map((p) => p.id) };
  }

  // 'mixed': if even the best group is not a valid 2M+2F (penalty hit), signal
  // fallback so the caller can use 'fair' and note it.
  if (mode === 'mixed') {
    const males = best.filter((p) => p.gender === 'M').length;
    const females = best.filter((p) => p.gender === 'F').length;
    if (males !== 2 || females !== 2) {
      return { playerIds: [], fellBack: true };
    }
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

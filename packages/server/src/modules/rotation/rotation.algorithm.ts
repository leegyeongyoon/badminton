/**
 * Rotation Algorithm for badminton court scheduling
 *
 * Given N players and M courts (4 players per court for doubles),
 * generates a fair round-robin schedule.
 *
 * Key rules:
 * 1. Fairness: all players play approximately equal number of games
 * 2. Variety: minimize repeated partner/opponent pairings
 * 3. "먹고치기": if N = M*4, no one sits out
 * 4. N > M*4: fewest-games-played players prioritized each round
 */

export interface RotationInput {
  playerIds: string[];
  courtIds: string[];
  targetRounds?: number;
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
    gamesCount.set(pid, 0);
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

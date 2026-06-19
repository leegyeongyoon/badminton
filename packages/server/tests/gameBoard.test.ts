/**
 * Integration: gameBoard compose critical path.
 *   create board → createQueueGame (2 players ok, per the 1~4 rule)
 *   create a 4-player queue game → assign to an EMPTY DOUBLES court
 *     → court becomes IN_USE + a Game exists
 *   suggest returns a foursome when ≥4 eligible
 *
 * Note: assigning a queued entry to a DOUBLES court materializes a CourtTurn via
 * registerTurn, which requires EXACTLY 4 players all checked in at the facility.
 * So the assigned entry uses 4 checked-in members; the 2-player entry only
 * exercises the createQueueGame 1~4 rule (it is not assigned to a court).
 */
import request from 'supertest';
import app from '../src/app';
import {
  prisma,
  createUser,
  createFacility,
  createClub,
  createActiveClubSession,
  checkInUser,
  addClubMember,
  disconnect,
  type CreatedUser,
} from './helpers';

let leaderToken: string;
let leaderId: string;
let facility: Awaited<ReturnType<typeof createFacility>>;
let clubId: string;
let clubSessionId: string;
let boardId: string;
// 4 members used for the assigned (materialized) game.
let assignPlayers: CreatedUser[];
// 4 additional eligible members used to verify suggest returns a foursome.
let suggestPlayers: CreatedUser[];

beforeAll(async () => {
  const leader = await createUser({ role: 'CLUB_LEADER' });
  leaderId = leader.id;
  facility = await createFacility({ radiusM: 100, courtCount: 2 });
  const club = await createClub({ facilityId: facility.id, leaderId });
  clubId = club.id;
  const session = await createActiveClubSession({
    clubId,
    facilityId: facility.id,
    startedById: leaderId,
    courtIds: facility.courtIds,
  });
  clubSessionId = session.id;

  // 8 members (4 for assign + 4 for suggest), all club members + checked in.
  assignPlayers = [];
  suggestPlayers = [];
  for (let i = 0; i < 8; i++) {
    const u = await createUser({ role: 'PLAYER', skillLevel: 'C' });
    await addClubMember(clubId, u.id, 'MEMBER');
    await checkInUser({ userId: u.id, facilityId: facility.id, clubSessionId });
    if (i < 4) assignPlayers.push(u);
    else suggestPlayers.push(u);
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone: leader.phone, password: 'password123' });
  leaderToken = login.body.tokens.accessToken;
});

afterAll(async () => {
  await disconnect();
});

describe('gameBoard compose', () => {
  it('create board (LEADER) → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/club-sessions/${clubSessionId}/game-board`)
      .set('Authorization', `Bearer ${leaderToken}`);
    expect(res.status).toBe(201);
    expect(res.body.clubSessionId).toBe(clubSessionId);
    boardId = res.body.id;
  });

  it('createQueueGame with 2 players is allowed (1~4 rule) → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/game-boards/${boardId}/queue`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ playerIds: [suggestPlayers[0].id, suggestPlayers[1].id] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.playerIds).toHaveLength(2);
    // Clean it up so those two stay eligible for the suggest test below.
    await prisma.gameBoardEntry.delete({ where: { id: res.body.id } });
  });

  it('createQueueGame with 5 players is rejected (>4) → 400', async () => {
    const five = [...assignPlayers, suggestPlayers[0]].map((p) => p.id);
    const res = await request(app)
      .post(`/api/v1/game-boards/${boardId}/queue`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ playerIds: five });
    expect(res.status).toBe(400);
  });

  it('assign a 4-player queued game to an EMPTY court → court IN_USE + Game exists', async () => {
    // 1. Create the 4-player queued entry.
    const create = await request(app)
      .post(`/api/v1/game-boards/${boardId}/queue`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ playerIds: assignPlayers.map((p) => p.id) });
    expect(create.status).toBe(201);
    const entryId = create.body.id;

    const targetCourtId = facility.courtIds[0];
    // Court starts EMPTY.
    const before = await prisma.court.findUnique({ where: { id: targetCourtId } });
    expect(before!.status).toBe('EMPTY');

    // 2. Assign to the empty court.
    const assign = await request(app)
      .post(`/api/v1/game-boards/${boardId}/entries/${entryId}/assign`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ courtId: targetCourtId });
    expect(assign.status).toBe(200);
    expect(assign.body.status).toBe('MATERIALIZED');
    expect(assign.body.courtId).toBe(targetCourtId);
    expect(assign.body.turnId).toEqual(expect.any(String));

    // 3. Court is now IN_USE and a Game exists for the materialized turn.
    const after = await prisma.court.findUnique({ where: { id: targetCourtId } });
    expect(after!.status).toBe('IN_USE');

    const game = await prisma.game.findUnique({ where: { turnId: assign.body.turnId } });
    expect(game).not.toBeNull();
    expect(game!.status).toBe('IN_PROGRESS');
    const gamePlayers = await prisma.gamePlayer.findMany({ where: { gameId: game!.id } });
    expect(gamePlayers).toHaveLength(4);
  });

  it('assigning onto the now-occupied court → 400', async () => {
    // Make a fresh queued entry then try to assign it to the IN_USE court.
    const create = await request(app)
      .post(`/api/v1/game-boards/${boardId}/queue`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ playerIds: suggestPlayers.map((p) => p.id) });
    const entryId = create.body.id;
    const occupiedCourtId = facility.courtIds[0];
    const res = await request(app)
      .post(`/api/v1/game-boards/${boardId}/entries/${entryId}/assign`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ courtId: occupiedCourtId });
    expect(res.status).toBe(400);
    // cleanup so suggestPlayers remain eligible for the suggest test
    await prisma.gameBoardEntry.delete({ where: { id: entryId } });
  });

  it('suggest returns a foursome when ≥4 eligible', async () => {
    // assignPlayers are now IN_TURN (excluded); suggestPlayers (4) are eligible:
    // checked in, not resting, not in a turn, not queued, not penalized.
    const res = await request(app)
      .post(`/api/v1/club-sessions/${clubSessionId}/suggest`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ count: 1 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.suggestions[0].playerIds).toHaveLength(4);
    // The suggested foursome must be drawn from the eligible (suggest) pool.
    const eligible = new Set(suggestPlayers.map((p) => p.id));
    for (const pid of res.body.suggestions[0].playerIds) {
      expect(eligible.has(pid)).toBe(true);
    }
  });
});

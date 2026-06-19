/**
 * Integration: clubSession lifecycle critical path.
 *   one-click start (NO pre-open facility session) → ACTIVE + facility session auto-created
 *   getSummary → attendance / games / guestFees
 *   getMatchups → partners
 *   end → ENDED
 */
import request from 'supertest';
import app from '../src/app';
import {
  prisma,
  createUser,
  createFacility,
  createClub,
  addClubMember,
  checkInUser,
  disconnect,
  type CreatedUser,
} from './helpers';

let leader: CreatedUser;
let leaderToken: string;
let facility: Awaited<ReturnType<typeof createFacility>>;
let clubId: string;
let sessionId: string;
let members: CreatedUser[];

beforeAll(async () => {
  leader = await createUser({ role: 'CLUB_LEADER' });
  facility = await createFacility({ radiusM: 100, courtCount: 2 });
  const club = await createClub({ facilityId: facility.id, leaderId: leader.id });
  clubId = club.id;

  members = [];
  for (let i = 0; i < 4; i++) {
    const u = await createUser({ role: 'PLAYER', skillLevel: 'C' });
    await addClubMember(clubId, u.id, 'MEMBER');
    members.push(u);
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone: leader.phone, password: 'password123' });
  leaderToken = login.body.tokens.accessToken;
});

afterAll(async () => {
  await disconnect();
});

describe('clubSession lifecycle', () => {
  it('one-click start with NO pre-open facility session → ACTIVE + facility session auto-created', async () => {
    // Precondition: facility has no OPEN facility session.
    const openBefore = await prisma.facilitySession.findFirst({
      where: { facilityId: facility.id, status: 'OPEN' },
    });
    expect(openBefore).toBeNull();

    const res = await request(app)
      .post(`/api/v1/clubs/${clubId}/sessions`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ facilityId: facility.id }); // courtIds omitted → defaults to all courts

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.facilitySessionId).toEqual(expect.any(String));
    sessionId = res.body.id;

    // A facility session was auto-created and is OPEN.
    const fs = await prisma.facilitySession.findUnique({ where: { id: res.body.facilitySessionId } });
    expect(fs).not.toBeNull();
    expect(fs!.status).toBe('OPEN');
    expect(fs!.facilityId).toBe(facility.id);

    // Defaulted to all (non-maintenance) facility courts.
    expect(res.body.courtIds.sort()).toEqual([...facility.courtIds].sort());
  });

  it('getSummary returns attendance / games / guestFees', async () => {
    // Seed attendance: 4 members check in, then play one game so summary has
    // games + perPlayer, plus an operator-added guest with a fee.
    for (const m of members) {
      await checkInUser({ userId: m.id, facilityId: facility.id, clubSessionId: sessionId });
    }
    // Operator adds a guest with a fee (exercises the guestFees branch).
    const guestRes = await request(app)
      .post(`/api/v1/club-sessions/${sessionId}/guests`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ name: '게스트A', skillLevel: 'D', feeAmount: 5000 });
    expect(guestRes.status).toBe(201);

    // Materialize a real game for the 4 members via the game board → assign.
    const board = await request(app)
      .post(`/api/v1/club-sessions/${sessionId}/game-board`)
      .set('Authorization', `Bearer ${leaderToken}`);
    const queue = await request(app)
      .post(`/api/v1/game-boards/${board.body.id}/queue`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ playerIds: members.map((m) => m.id) });
    const assign = await request(app)
      .post(`/api/v1/game-boards/${board.body.id}/entries/${queue.body.id}/assign`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ courtId: facility.courtIds[0] });
    expect(assign.status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/club-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${leaderToken}`);
    expect(res.status).toBe(200);

    // attendance: 4 members + 1 guest
    expect(res.body.attendance.memberCount).toBe(4);
    expect(res.body.attendance.guestCount).toBe(1);
    expect(res.body.attendance.total).toBe(5);

    // games: one game with 4 players
    expect(res.body.games.total).toBe(1);
    expect(res.body.games.perPlayer).toHaveLength(4);
    expect(res.body.games.perPlayer.every((p: any) => p.count === 1)).toBe(true);

    // guestFees: the 5000 fee, unpaid
    expect(res.body.guestFees.totalFee).toBe(5000);
    expect(res.body.guestFees.unpaidFee).toBe(5000);
    expect(res.body.guestFees.guestCount).toBe(1);
  });

  it('getMatchups returns partners for a player', async () => {
    // members[0] played one game with the other 3 → 3 partners, each count 1.
    const res = await request(app)
      .get(`/api/v1/club-sessions/${sessionId}/players/${members[0].id}/matchups`)
      .set('Authorization', `Bearer ${leaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(members[0].id);
    expect(res.body.totalGames).toBe(1);
    expect(res.body.partners).toHaveLength(3);
    const partnerIds = res.body.partners.map((p: any) => p.userId).sort();
    expect(partnerIds).toEqual(members.slice(1).map((m) => m.id).sort());
    expect(res.body.partners.every((p: any) => p.count === 1)).toBe(true);
  });

  it('end → ENDED', async () => {
    const res = await request(app)
      .post(`/api/v1/club-sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${leaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ENDED');
    expect(res.body.endedAt).toEqual(expect.any(String));

    const persisted = await prisma.clubSession.findUnique({ where: { id: sessionId } });
    expect(persisted!.status).toBe('ENDED');
  });
});

/**
 * Integration: check-in geofence critical path.
 * Seed a facility with coords + a FacilityPolicy radius + an ACTIVE ClubSession.
 *   member check-in IN range  → 201
 *   member check-in OUT of range → 400 with details.distanceM
 *   guest check-in (unauth) IN range → 201 with a token (router returns 201)
 */
import request from 'supertest';
import app from '../src/app';
import {
  prisma,
  createUser,
  createFacility,
  createClub,
  createActiveClubSession,
  disconnect,
} from './helpers';

let token: string;
let facility: Awaited<ReturnType<typeof createFacility>>;
let clubSessionId: string;

beforeAll(async () => {
  const leader = await createUser({ role: 'CLUB_LEADER' });
  const member = await createUser({ role: 'PLAYER', skillLevel: 'C' });
  facility = await createFacility({ radiusM: 100, courtCount: 2 });
  const club = await createClub({ facilityId: facility.id, leaderId: leader.id, memberIds: [member.id] });
  const session = await createActiveClubSession({
    clubId: club.id,
    facilityId: facility.id,
    startedById: leader.id,
    courtIds: facility.courtIds,
  });
  clubSessionId = session.id;

  // Login the member to get a bearer token.
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone: member.phone, password: 'password123' });
  token = login.body.tokens.accessToken;
});

afterAll(async () => {
  await disconnect();
});

describe('checkin geofence', () => {
  it('member check-in IN range → 201', async () => {
    const res = await request(app)
      .post('/api/v1/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        qrData: facility.qrData,
        clubSessionId,
        latitude: facility.latitude, // exactly on the facility → distance 0
        longitude: facility.longitude,
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      facilityId: facility.id,
      clubSessionId,
    });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it('member check-in OUT of range → 400 with details.distanceM', async () => {
    // Use a different user so the duplicate-checkin guard doesn't fire first.
    const other = await createUser({ role: 'PLAYER' });
    await prisma.clubMember.create({
      data: {
        clubId: (await prisma.clubSession.findUnique({ where: { id: clubSessionId } }))!.clubId,
        userId: other.id,
        role: 'MEMBER',
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: other.phone, password: 'password123' });
    const otherToken = login.body.tokens.accessToken;

    const res = await request(app)
      .post('/api/v1/checkin')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        qrData: facility.qrData,
        clubSessionId,
        latitude: facility.latitude + 0.05, // ~5.5 km north → far out of the 100m fence
        longitude: facility.longitude,
      });

    expect(res.status).toBe(400);
    // BadRequestError carries details: { distanceM, radiusM, facilityName }
    expect(res.body.details).toBeDefined();
    expect(typeof res.body.details.distanceM).toBe('number');
    expect(res.body.details.distanceM).toBeGreaterThan(facility.radiusM);
  });

  it('guest check-in (unauth) IN range → 201 with a token', async () => {
    const res = await request(app)
      .post('/api/v1/checkin/guest')
      .send({
        qrData: facility.qrData,
        clubSessionId,
        name: '게스트손님',
        skillLevel: 'D',
        gender: 'M',
        latitude: facility.latitude,
        longitude: facility.longitude,
      });
    // The guest router responds 201 (creates a guest user + check-in).
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: '게스트손님', isGuest: true });
    expect(res.body.checkIn).toMatchObject({ facilityId: facility.id, clubSessionId });
  });

  it('guest check-in OUT of range → 400 with details.distanceM', async () => {
    const res = await request(app)
      .post('/api/v1/checkin/guest')
      .send({
        qrData: facility.qrData,
        clubSessionId,
        name: '먼손님',
        latitude: facility.latitude + 0.05,
        longitude: facility.longitude,
      });
    expect(res.status).toBe(400);
    expect(res.body.details?.distanceM).toBeGreaterThan(facility.radiusM);
  });
});

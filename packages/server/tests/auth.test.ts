/**
 * Integration: auth critical path.
 *   register (with skillLevel/gender) → login → /auth/me with the token
 *   wrong password → 401
 *   duplicate phone → 409
 */
import request from 'supertest';
import app from '../src/app';
import { prisma, uniquePhone, disconnect } from './helpers';

afterAll(async () => {
  await disconnect();
});

describe('auth', () => {
  const phone = uniquePhone();
  const password = 'password123';
  let accessToken: string;
  let userId: string;

  it('register persists user + skillLevel/gender profile and returns tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone, password, name: '테스트유저', skillLevel: 'B', gender: 'F' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ phone, name: '테스트유저', role: 'PLAYER', isGuest: false });
    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.tokens.refreshToken).toEqual(expect.any(String));
    userId = res.body.user.id;

    // skillLevel/gender landed on the PlayerProfile
    const profile = await prisma.playerProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile!.skillLevel).toBe('B');
    expect(profile!.gender).toBe('F');
  });

  it('login with correct password returns tokens', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ phone, password });
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
    accessToken = res.body.tokens.accessToken;
  });

  it('GET /auth/me with the token returns the current user', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: userId, phone, name: '테스트유저', role: 'PLAYER' });
  });

  it('GET /auth/me without a token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('login with wrong password → 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ phone, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('register with a duplicate phone → 409', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone, password, name: '중복유저' });
    expect(res.status).toBe(409);
  });
});

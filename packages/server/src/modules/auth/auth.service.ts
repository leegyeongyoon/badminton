import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma';
import { AppError, ConflictError, UnauthorizedError, BadRequestError } from '../../utils/errors';
import { AuthPayload } from '../../middleware/auth';
import type { RegisterInput, LoginInput, KakaoLoginInput, CompleteProfileInput } from '@badminton/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export function generateTokens(payload: AuthPayload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
  return { accessToken, refreshToken };
}

/**
 * Shape of a User row WITH its PlayerProfile (used to build every auth response).
 * `profile` is nullable because not every user has completed their profile yet.
 */
type UserWithProfile = {
  id: string;
  phone: string | null;
  name: string;
  role: string;
  isGuest: boolean;
  createdAt: Date;
  profile: { skillLevel: string | null; gender: string | null } | null;
};

/**
 * Build the canonical user response object returned by EVERY auth endpoint
 * (login / kakaoLogin / completeProfile / getMe). Always includes the 급수
 * (skillLevel) and 성별 (gender) from the PlayerProfile so the client gate can
 * tell whether the profile is complete (e.g. prompt 급수 when missing).
 */
function toUserResponse(user: UserWithProfile) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    isGuest: user.isGuest,
    createdAt: user.createdAt.toISOString(),
    skillLevel: user.profile?.skillLevel ?? null,
    gender: user.profile?.gender ?? null,
  };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (existing) {
    throw new ConflictError('이미 등록된 전화번호입니다');
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      phone: input.phone,
      password: hashedPassword,
      name: input.name,
      role: input.role,
    },
  });

  // Persist skill level (급수) / gender on the user's PlayerProfile when provided at signup.
  if (input.skillLevel !== undefined || input.gender !== undefined) {
    await prisma.playerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...(input.skillLevel !== undefined && { skillLevel: input.skillLevel }),
        ...(input.gender !== undefined && { gender: input.gender }),
      },
      update: {
        ...(input.skillLevel !== undefined && { skillLevel: input.skillLevel }),
        ...(input.gender !== undefined && { gender: input.gender }),
      },
    });
  }

  const payload: AuthPayload = { userId: user.id, role: user.role };
  const tokens = generateTokens(payload);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken },
  });

  // Re-fetch WITH the profile so the response carries skillLevel/gender just set above.
  const withProfile = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { profile: true },
  });

  return {
    // A phone-register always creates a brand-new account.
    isNew: true,
    user: toUserResponse(withProfile),
    tokens,
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { phone: input.phone }, include: { profile: true } });
  // Guests have null phone/password and can never log in; treat missing password as invalid.
  if (!user || !user.password) {
    throw new UnauthorizedError('전화번호 또는 비밀번호가 올바르지 않습니다');
  }

  const valid = await bcrypt.compare(input.password, user.password);
  if (!valid) {
    throw new UnauthorizedError('전화번호 또는 비밀번호가 올바르지 않습니다');
  }

  const payload: AuthPayload = { userId: user.id, role: user.role };
  const tokens = generateTokens(payload);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken },
  });

  return {
    // Existing account signing in — never the onboarding path.
    isNew: false,
    user: toUserResponse(user),
    tokens,
  };
}

/**
 * Exchange a Kakao authorization `code` for a Kakao access token, SERVER-SIDE.
 *
 * This is the secure half of the flow: the client_secret lives only here on the
 * backend (the Kakao app is SHARED with the sibling service, so the secret must
 * never reach the web/mobile bundle). The client sends us the `code` it got from
 * Kakao's authorize step plus the EXACT `redirectUri` it used (Kakao requires
 * the redirect_uri at exchange time to match the one used at authorize time).
 *
 * Throws:
 *   - 503 '카카오 로그인이 설정되지 않았습니다' if our Kakao keys aren't loaded
 *     (so a misconfigured server never 500s on this path).
 *   - 401 '카카오 인증에 실패했습니다' on any non-200 / network error from Kakao.
 */
async function exchangeKakaoCode(code: string, redirectUri: string): Promise<string> {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(503, '카카오 로그인이 설정되지 않았습니다');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  let tokenRes: globalThis.Response;
  try {
    tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: body.toString(),
    });
  } catch {
    // Network failure reaching Kakao's token endpoint — auth failure, not 500.
    throw new UnauthorizedError('카카오 인증에 실패했습니다');
  }

  if (!tokenRes.ok) {
    // Surface Kakao's actual error (status + body) so misconfig (invalid_client /
    // redirect_uri mismatch / KOE codes) is diagnosable. The body holds Kakao
    // error codes only — never our client_secret.
    let detail = '';
    try { detail = (await tokenRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[kakao] token exchange failed', tokenRes.status, detail);
    throw new UnauthorizedError(`카카오 인증 실패(토큰교환) [${tokenRes.status}] ${detail}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new UnauthorizedError('카카오 인증 실패(토큰없음)');
  }
  return tokenData.access_token;
}

/**
 * Kakao social login (secure server-side authorization-code flow).
 *
 * Accepts EITHER:
 *   - { code, redirectUri } — preferred. We exchange the code for a Kakao access
 *     token server-side (using our client_secret), keeping the secret off the
 *     client entirely.
 *   - { accessToken } — kept for a future native Kakao SDK that hands us a Kakao
 *     access token directly.
 *
 * In both cases we then validate the Kakao access token against Kakao's user API,
 * upsert a PLAYER User keyed by the Kakao account id, and issue OUR JWTs so a
 * Kakao-logged-in user behaves like any other authenticated member. The response
 * shape ({ user, tokens }) is identical to /auth/login.
 */
export async function kakaoLogin(input: KakaoLoginInput) {
  // Resolve a Kakao access token from whichever shape the client sent.
  const accessToken =
    input.code && input.redirectUri
      ? await exchangeKakaoCode(input.code, input.redirectUri)
      : input.accessToken!;

  let kakaoRes: globalThis.Response;
  try {
    kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network failure reaching Kakao — surface as an auth failure (not a 500).
    throw new UnauthorizedError('카카오 인증에 실패했습니다');
  }

  if (!kakaoRes.ok) {
    let detail = '';
    try { detail = (await kakaoRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[kakao] user/me failed', kakaoRes.status, detail);
    throw new UnauthorizedError(`카카오 인증 실패(사용자조회) [${kakaoRes.status}] ${detail}`);
  }

  const data = (await kakaoRes.json()) as {
    id?: number;
    kakao_account?: { profile?: { nickname?: string } };
  };

  if (data.id == null) {
    throw new UnauthorizedError('카카오 인증에 실패했습니다');
  }

  const kakaoId = String(data.id);
  const nickname = data.kakao_account?.profile?.nickname || '카카오회원';

  // Upsert by kakaoId: existing Kakao user → that user; otherwise create a new
  // PLAYER (phone/password null, isGuest false) plus a default PlayerProfile.
  // `isNew` is true only when we just created the account — the client uses it
  // to route brand-new Kakao users through the profile-setup step before home.
  let user = await prisma.user.findUnique({ where: { kakaoId } });
  let isNew = false;
  if (!user) {
    isNew = true;
    user = await prisma.user.create({
      data: {
        kakaoId,
        name: nickname,
        role: 'PLAYER',
        isGuest: false,
        profile: { create: {} },
      },
    });
  }

  const payload: AuthPayload = { userId: user.id, role: user.role };
  const tokens = generateTokens(payload);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken },
  });

  // Fetch WITH the profile so the response includes skillLevel/gender (a brand-new
  // Kakao user has an empty profile → both null, which drives the profile-setup gate).
  const withProfile = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { profile: true },
  });

  return {
    isNew,
    user: toUserResponse(withProfile),
    tokens,
  };
}

/**
 * New-user profile completion (신규 가입자 프로필 설정).
 *
 * Sets the caller's display name and upserts their PlayerProfile (급수/성별).
 * Used by the onboarding step after a new Kakao sign-up. Reuses the same
 * PlayerProfile upsert shape as register/updateMemberProfile.
 */
export async function completeProfile(userId: string, input: CompleteProfileInput) {
  await prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
  });

  await prisma.playerProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...(input.skillLevel !== undefined && { skillLevel: input.skillLevel }),
      ...(input.gender !== undefined && { gender: input.gender }),
    },
    update: {
      ...(input.skillLevel !== undefined && { skillLevel: input.skillLevel }),
      ...(input.gender !== undefined && { gender: input.gender }),
    },
  });

  // Return WITH the freshly-upserted profile so the client's local user carries
  // the new skillLevel (so the profile-setup gate won't re-prompt).
  const withProfile = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  return toUserResponse(withProfile);
}

export async function refresh(refreshToken: string) {
  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as AuthPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.refreshToken !== refreshToken) {
      throw new UnauthorizedError('유효하지 않은 리프레시 토큰입니다');
    }

    const newPayload: AuthPayload = { userId: user.id, role: user.role };
    const tokens = generateTokens(newPayload);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return { tokens };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new UnauthorizedError('유효하지 않은 리프레시 토큰입니다');
  }
}

export async function logout(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.password) throw new UnauthorizedError();

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    throw new BadRequestError('현재 비밀번호가 올바르지 않습니다');
  }

  if (newPassword.length < 6) {
    throw new BadRequestError('새 비밀번호는 6자 이상이어야 합니다');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, refreshToken: null },
  });
}

export async function updatePushToken(userId: string, token: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { expoPushToken: token },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user) throw new UnauthorizedError();
  return toUserResponse(user);
}

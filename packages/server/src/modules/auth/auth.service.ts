import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma';
import { AppError, ConflictError, UnauthorizedError, BadRequestError } from '../../utils/errors';
import { AuthPayload } from '../../middleware/auth';
import type { RegisterInput, RegisterOperatorInput, LoginInput, KakaoLoginInput, GoogleLoginInput, CompleteProfileInput, LinkProviderInput } from '@badminton/shared';

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
  accountStatus: string;
  createdAt: Date;
  // Linked-provider ids + password presence drive linkedProviders/hasPassword in
  // the response so the client can show 연동 status + enforce "keep ≥1 method".
  kakaoId: string | null;
  googleId: string | null;
  password: string | null;
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
    // 계정 상태(운영자 회원가입 승인 대기 여부). 클라 루트 게이트가 PENDING/REJECTED
    // 를 보고 승인 대기 화면으로 보낸다.
    accountStatus: user.accountStatus,
    createdAt: user.createdAt.toISOString(),
    skillLevel: user.profile?.skillLevel ?? null,
    gender: user.profile?.gender ?? null,
    // Linked social providers (✓연동됨 vs 연동 in the client). A provider is
    // "linked" when its id column is non-null.
    linkedProviders: {
      kakao: user.kakaoId != null,
      google: user.googleId != null,
    },
    // hasPassword = a phone account. Together with linkedProviders the client
    // counts the user's login methods and blocks unlinking the LAST one.
    hasPassword: user.password != null,
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

/**
 * 운영자(모임 관리자) 회원가입 신청.
 *
 * 전화+비번 계정을 만들되 accountStatus=PENDING 으로 시작(승인 전까지 앱 사용 차단)하고,
 * 동시에 최고관리자(SUPER_ADMIN)가 검토할 OperatorRequest(PENDING) 를 생성한다. 신청서에
 * 담긴 운영하려는 모임 이름(clubName)·활동 지역(region)은 승인 판단용으로 요청에 저장된다.
 * 승인되면 OperatorRequest.reviewRequest 가 role=CLUB_LEADER + accountStatus=ACTIVE 로 푼다.
 *
 * 계정은 만들어지고 토큰도 발급되므로 신청 직후 곧바로 로그인 상태가 되지만, 클라 루트
 * 게이트가 accountStatus=PENDING 을 보고 승인 대기 화면으로 보낸다.
 */
export async function registerOperator(input: RegisterOperatorInput) {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
  const hashedPassword = await bcrypt.hash(input.password, 10);

  let userId: string;

  if (existing) {
    // 같은 번호로 다시 신청한 경우 — 계정 상태에 따라 다르게 처리한다.
    if (existing.accountStatus === 'REJECTED') {
      // 거절된 운영자 회원가입 계정은 재신청 허용: 정보를 갱신하고 새 승인 신청을
      // 만들어 다시 승인 대기(PENDING)로. REJECTED 는 운영자 회원가입 거절 경로에서만
      // 생기므로(활성 회원은 항상 ACTIVE) 활성 계정을 가로챌 위험이 없다.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existing.id },
          data: { name: input.name, password: hashedPassword, accountStatus: 'PENDING' },
        });
        await tx.operatorRequest.create({
          data: { userId: existing.id, status: 'PENDING', clubName: input.clubName, region: input.region ?? null },
        });
      });
      userId = existing.id;
    } else if (existing.accountStatus === 'PENDING') {
      // 이미 신청 접수 + 승인 대기 중 — 로그인해서 상태를 확인하도록 안내.
      throw new ConflictError('이미 가입 신청이 접수되어 승인 대기 중이에요. 로그인 후 확인해 주세요');
    } else {
      // 활성 계정(이미 가입된 회원/운영자) — 신규 가입 대신 로그인 안내.
      throw new ConflictError('이미 가입된 번호예요. 로그인해 주세요');
    }
  } else {
    // 신규 — 계정 + 승인 신청을 한 트랜잭션으로(부분 생성 방지).
    const created = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          phone: input.phone,
          password: hashedPassword,
          name: input.name,
          role: 'PLAYER',
          accountStatus: 'PENDING',
        },
      });
      await tx.operatorRequest.create({
        data: { userId: u.id, status: 'PENDING', clubName: input.clubName, region: input.region ?? null },
      });
      return u;
    });
    userId = created.id;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const payload: AuthPayload = { userId: dbUser.id, role: dbUser.role };
  const tokens = generateTokens(payload);

  await prisma.user.update({
    where: { id: dbUser.id },
    data: { refreshToken: tokens.refreshToken },
  });

  const withProfile = await prisma.user.findUniqueOrThrow({
    where: { id: dbUser.id },
    include: { profile: true },
  });

  return {
    isNew: !existing,
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
 * Exchange a Google authorization `code` for a Google access token, SERVER-SIDE.
 *
 * Mirrors exchangeKakaoCode: the client_secret lives only here on the backend
 * (never reaches the web/mobile bundle). The client sends us the `code` it got
 * from Google's authorize step plus the EXACT `redirectUri` it used (Google
 * requires the redirect_uri at exchange time to match the one used at authorize
 * time).
 *
 * Throws:
 *   - 503 '구글 로그인이 설정되지 않았습니다' if our Google keys aren't loaded
 *     (so a misconfigured server never 500s on this path).
 *   - 401 '구글 인증에 실패했습니다' on any non-200 / network error from Google.
 */
async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(503, '구글 로그인이 설정되지 않았습니다');
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
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: body.toString(),
    });
  } catch {
    // Network failure reaching Google's token endpoint — auth failure, not 500.
    throw new UnauthorizedError('구글 인증에 실패했습니다');
  }

  if (!tokenRes.ok) {
    // Surface Google's actual error (status + body) so misconfig (invalid_grant /
    // redirect_uri_mismatch / invalid_client) is diagnosable. The body holds
    // Google error codes only — never our client_secret.
    let detail = '';
    try { detail = (await tokenRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[google] token exchange failed', tokenRes.status, detail);
    throw new UnauthorizedError(`구글 인증 실패(토큰교환) [${tokenRes.status}] ${detail}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new UnauthorizedError('구글 인증 실패(토큰없음)');
  }
  return tokenData.access_token;
}

/**
 * Google social login (secure server-side authorization-code flow).
 *
 * Mirrors kakaoLogin. Accepts EITHER:
 *   - { code, redirectUri } — preferred. We exchange the code for a Google
 *     access token server-side (using our client_secret), keeping the secret off
 *     the client entirely.
 *   - { accessToken } — kept for a future native Google SDK that hands us a
 *     Google access token directly.
 *
 * In both cases we then fetch the Google user info, upsert a PLAYER User keyed
 * by the Google account id (sub), and issue OUR JWTs so a Google-logged-in user
 * behaves like any other authenticated member. The response shape
 * ({ isNew, user, tokens }) is identical to /auth/kakao and /auth/login.
 */
export async function googleLogin(input: GoogleLoginInput) {
  // Resolve a Google access token from whichever shape the client sent.
  const accessToken =
    input.code && input.redirectUri
      ? await exchangeGoogleCode(input.code, input.redirectUri)
      : input.accessToken!;

  let googleRes: globalThis.Response;
  try {
    googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network failure reaching Google — surface as an auth failure (not a 500).
    throw new UnauthorizedError('구글 인증에 실패했습니다');
  }

  if (!googleRes.ok) {
    let detail = '';
    try { detail = (await googleRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[google] userinfo failed', googleRes.status, detail);
    throw new UnauthorizedError(`구글 인증 실패(사용자조회) [${googleRes.status}] ${detail}`);
  }

  const data = (await googleRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  if (!data.sub) {
    throw new UnauthorizedError('구글 인증에 실패했습니다');
  }

  const googleId = data.sub;
  // Name = Google name, else email local-part, else a friendly fallback.
  const emailLocalPart = data.email ? data.email.split('@')[0] : undefined;
  const displayName = data.name || emailLocalPart || '구글회원';

  // Upsert by googleId: existing Google user → that user; otherwise create a new
  // PLAYER (phone/password null, isGuest false) plus a default PlayerProfile.
  // `isNew` is true only when we just created the account — the client uses it
  // to route brand-new Google users through the profile-setup step before home.
  let user = await prisma.user.findUnique({ where: { googleId } });
  let isNew = false;
  if (!user) {
    isNew = true;
    user = await prisma.user.create({
      data: {
        googleId,
        name: displayName,
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
  // Google user has an empty profile → both null, which drives the profile-setup gate).
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

// ───────────────────────────────────────────────────────────────────────────
// Manual account linking (계정 연동)
//
// A logged-in user attaches a SECOND social provider to their ONE account so a
// later login with EITHER provider resolves to the SAME account. These REUSE the
// exact same secure server-side code-exchange + provider userinfo as the social
// LOGIN path above (exchangeKakaoCode/exchangeGoogleCode + the user/me / userinfo
// fetch), but instead of upserting/creating a user they resolve ONLY the provider
// id and attach it to the CURRENT authenticated user (userId). The login path is
// completely untouched.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve a Kakao account id from a { code, redirectUri } using the SAME exchange
 * + user/me call as kakaoLogin — but WITHOUT creating/logging in any user. Used
 * by the link flow to discover which Kakao identity to attach to the current
 * account. Throws the same diagnosable auth errors as the login path.
 */
async function resolveKakaoIdFromCode(code: string, redirectUri: string): Promise<string> {
  const accessToken = await exchangeKakaoCode(code, redirectUri);

  let kakaoRes: globalThis.Response;
  try {
    kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new UnauthorizedError('카카오 인증에 실패했습니다');
  }

  if (!kakaoRes.ok) {
    let detail = '';
    try { detail = (await kakaoRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[kakao] user/me failed (link)', kakaoRes.status, detail);
    throw new UnauthorizedError(`카카오 인증 실패(사용자조회) [${kakaoRes.status}] ${detail}`);
  }

  const data = (await kakaoRes.json()) as { id?: number };
  if (data.id == null) {
    throw new UnauthorizedError('카카오 인증에 실패했습니다');
  }
  return String(data.id);
}

/**
 * Resolve a Google account id (sub) from a { code, redirectUri } using the SAME
 * exchange + userinfo call as googleLogin — but WITHOUT creating/logging in any
 * user. Used by the link flow. Throws the same diagnosable auth errors.
 */
async function resolveGoogleIdFromCode(code: string, redirectUri: string): Promise<string> {
  const accessToken = await exchangeGoogleCode(code, redirectUri);

  let googleRes: globalThis.Response;
  try {
    googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new UnauthorizedError('구글 인증에 실패했습니다');
  }

  if (!googleRes.ok) {
    let detail = '';
    try { detail = (await googleRes.text()).slice(0, 300); } catch { /* noop */ }
    console.error('[google] userinfo failed (link)', googleRes.status, detail);
    throw new UnauthorizedError(`구글 인증 실패(사용자조회) [${googleRes.status}] ${detail}`);
  }

  const data = (await googleRes.json()) as { sub?: string };
  if (!data.sub) {
    throw new UnauthorizedError('구글 인증에 실패했습니다');
  }
  return data.sub;
}

/** Re-fetch the current user WITH profile and return the canonical user response. */
async function getUserResponse(userId: string) {
  const withProfile = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  return toUserResponse(withProfile);
}

/**
 * 그 소셜 id가 붙어 있는 '다른 계정'에 실제 활동 내역(모임 멤버십/체크인)이 있는지.
 * 활동이 없으면 '빈 중복 계정'(소셜로 한 번 들어왔다 아무것도 안 한 계정)으로 보고
 * 연동 시 흡수(삭제)해도 안전하다. 활동이 있으면 흡수하지 않고 안내한다.
 */
async function otherAccountHasActivity(otherUserId: string): Promise<boolean> {
  const [members, checkins] = await Promise.all([
    prisma.clubMember.count({ where: { userId: otherUserId } }),
    prisma.checkIn.count({ where: { userId: otherUserId } }),
  ]);
  return members > 0 || checkins > 0;
}

/**
 * Link a Kakao account to the CURRENT user (authenticated). Resolves the Kakao id:
 *   - already on THIS user → idempotent.
 *   - on ANOTHER user that is an EMPTY duplicate (no 모임/출석) → 흡수: 그 빈 계정을
 *     삭제하고 이 계정에 kakaoId를 붙인다(데이터 손실 없음).
 *   - on ANOTHER user WITH activity → 409: 그 계정으로 로그인하라고 안내(자동 병합 안 함).
 */
export async function linkKakao(userId: string, input: LinkProviderInput) {
  const kakaoId = await resolveKakaoIdFromCode(input.code, input.redirectUri);

  const existing = await prisma.user.findUnique({ where: { kakaoId } });
  if (existing && existing.id !== userId) {
    if (await otherAccountHasActivity(existing.id)) {
      throw new ConflictError('이미 다른 계정에서 활동 중인 카카오 계정이에요. 그 계정으로 로그인해 주세요');
    }
    // 빈 중복 계정 흡수: 삭제(소셜 id 해제) + 현재 계정에 부착을 원자적으로.
    await prisma.$transaction([
      prisma.user.delete({ where: { id: existing.id } }),
      prisma.user.update({ where: { id: userId }, data: { kakaoId } }),
    ]);
    return getUserResponse(userId);
  }
  if (!existing) {
    await prisma.user.update({ where: { id: userId }, data: { kakaoId } });
  }
  return getUserResponse(userId);
}

/**
 * Link a Google account to the CURRENT user (authenticated). Mirrors linkKakao
 * (빈 중복 계정은 흡수, 활동 있는 계정은 409 안내).
 */
export async function linkGoogle(userId: string, input: LinkProviderInput) {
  const googleId = await resolveGoogleIdFromCode(input.code, input.redirectUri);

  const existing = await prisma.user.findUnique({ where: { googleId } });
  if (existing && existing.id !== userId) {
    if (await otherAccountHasActivity(existing.id)) {
      throw new ConflictError('이미 다른 계정에서 활동 중인 구글 계정이에요. 그 계정으로 로그인해 주세요');
    }
    await prisma.$transaction([
      prisma.user.delete({ where: { id: existing.id } }),
      prisma.user.update({ where: { id: userId }, data: { googleId } }),
    ]);
    return getUserResponse(userId);
  }
  if (!existing) {
    await prisma.user.update({ where: { id: userId }, data: { googleId } });
  }
  return getUserResponse(userId);
}

/**
 * Count how many login methods a user has: password (phone) + each linked
 * provider. Used by the unlink guard to keep at least one.
 */
function countLoginMethods(u: { password: string | null; kakaoId: string | null; googleId: string | null }): number {
  let n = 0;
  if (u.password != null) n += 1;
  if (u.kakaoId != null) n += 1;
  if (u.googleId != null) n += 1;
  return n;
}

/**
 * Unlink Kakao from the CURRENT user. GUARDS that the user keeps ≥1 login method
 * (another provider OR a password) — unlinking the last method → 400. Idempotent
 * when Kakao isn't linked (nothing to do, but still guard-checked so we never
 * leave the account with zero methods).
 */
export async function unlinkKakao(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();

  // Only enforce the guard when Kakao is actually the thing being removed; if it
  // isn't linked, removing it changes nothing and the account keeps its methods.
  if (user.kakaoId != null && countLoginMethods(user) <= 1) {
    throw new BadRequestError('마지막 로그인 수단은 해제할 수 없어요');
  }

  if (user.kakaoId != null) {
    await prisma.user.update({ where: { id: userId }, data: { kakaoId: null } });
  }
  return getUserResponse(userId);
}

/**
 * Unlink Google from the CURRENT user. Mirrors unlinkKakao.
 */
export async function unlinkGoogle(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();

  if (user.googleId != null && countLoginMethods(user) <= 1) {
    throw new BadRequestError('마지막 로그인 수단은 해제할 수 없어요');
  }

  if (user.googleId != null) {
    await prisma.user.update({ where: { id: userId }, data: { googleId: null } });
  }
  return getUserResponse(userId);
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

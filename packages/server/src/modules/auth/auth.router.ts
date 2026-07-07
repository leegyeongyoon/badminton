import { Router, Request, Response, NextFunction } from 'express';
import { registerSchema, registerOperatorSchema, loginSchema, kakaoLoginSchema, googleLoginSchema, pushTokenSchema, changePasswordSchema, completeProfileSchema, linkProviderSchema } from '@badminton/shared';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import * as authService from './auth.service';

const router = Router();

// Brute-force / abuse protection (per-IP, in-memory fixed window).
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'auth:register' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'auth:login' });
const kakaoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth:kakao' });
const googleLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth:google' });

router.post('/register', registerLimiter, validate(registerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// 운영자(모임 관리자) 회원가입 신청 — 계정 생성 + 최고관리자 승인 대기(OperatorRequest).
// register 와 동일한 남용 방지 리미터를 재사용한다.
router.post('/register-operator', registerLimiter, validate(registerOperatorSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.registerOperator(req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/login', loginLimiter, validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// Kakao social login (unauthenticated). Players sign in with Kakao via the
// secure server-side authorization-code flow: the body carries { code,
// redirectUri } (preferred) or { accessToken } (future native SDK). The service
// exchanges the code for a Kakao access token using our client_secret (which
// never leaves the backend) and validates it against Kakao.
router.post('/kakao', kakaoLimiter, validate(kakaoLoginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.kakaoLogin(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// Google social login (unauthenticated). Mirrors /kakao: players sign in with
// Google via the secure server-side authorization-code flow. The body carries
// { code, redirectUri } (preferred) or { accessToken } (future native SDK). The
// service exchanges the code for a Google access token using our client_secret
// (which never leaves the backend) and validates it against Google.
router.post('/google', googleLimiter, validate(googleLoginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.googleLogin(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Manual account linking (계정 연동) — AUTHENTICATED ──────────────────────
// A logged-in user attaches a SECOND social provider to their ONE account. The
// body is { code, redirectUri } (same shape as social login). The service reuses
// the secure server-side code-exchange + provider userinfo to resolve the
// provider id, then attaches it to req.user.userId (it does NOT create/login a
// new user). 409 if the provider id already belongs to ANOTHER account.
router.post('/link/kakao', authenticate, kakaoLimiter, validate(linkProviderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.linkKakao(req.user!.userId, req.body);
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/link/google', authenticate, googleLimiter, validate(linkProviderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.linkGoogle(req.user!.userId, req.body);
    res.json(user);
  } catch (err) { next(err); }
});

// Unlink a social provider (AUTHENTICATED). GUARD: the user must retain ≥1 login
// method (another linked provider OR a password) — unlinking the last → 400.
router.post('/unlink/kakao', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.unlinkKakao(req.user!.userId);
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/unlink/google', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.unlinkGoogle(req.user!.userId);
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/push-token', authenticate, validate(pushTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.updatePushToken(req.user!.userId, req.body.token);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// New-user profile completion (신규 카카오 가입자 프로필 설정). Auth required:
// sets the caller's name + upserts their PlayerProfile (급수/성별).
router.post('/complete-profile', authenticate, validate(completeProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.completeProfile(req.user!.userId, req.body);
    res.json(user);
  } catch (err) { next(err); }
});

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getMe(req.user!.userId);
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.logout(req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/change-password', authenticate, validate(changePasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;

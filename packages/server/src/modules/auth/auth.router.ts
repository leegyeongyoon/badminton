import { Router, Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema, kakaoLoginSchema, pushTokenSchema, changePasswordSchema, completeProfileSchema } from '@badminton/shared';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import * as authService from './auth.service';

const router = Router();

// Brute-force / abuse protection (per-IP, in-memory fixed window).
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'auth:register' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'auth:login' });
const kakaoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth:kakao' });

router.post('/register', registerLimiter, validate(registerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.register(req.body);
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

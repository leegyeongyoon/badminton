import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma';
import { AppError, ConflictError, UnauthorizedError } from '../../utils/errors';
import { AuthPayload } from '../../middleware/auth';
import type { RegisterInput, LoginInput } from '@badminton/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function generateTokens(payload: AuthPayload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
  return { accessToken, refreshToken };
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

  const payload: AuthPayload = { userId: user.id, role: user.role };
  const tokens = generateTokens(payload);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken },
  });

  return {
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
    tokens,
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (!user) {
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
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
    tokens,
  };
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

export async function updatePushToken(userId: string, token: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { expoPushToken: token },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();
  return { id: user.id, phone: user.phone, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() };
}

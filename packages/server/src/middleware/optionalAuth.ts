import { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * 로그인 상태면 userId 추출(선택적) — 무인증 공개 엔드포인트용.
 * 토큰이 없거나 무효여도 에러 없이 null을 돌려줘 익명으로 진행한다.
 * (guestApply/guestChat 라우터에 중복돼 있던 사본을 공용으로 추출)
 */
export function optionalUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev-secret') as { userId?: string };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

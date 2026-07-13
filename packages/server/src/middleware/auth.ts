import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../utils/errors';
import { noteSeen } from '../modules/admin/metrics.service';

export interface AuthPayload {
  userId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError());
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as AuthPayload;
    req.user = payload;
    noteSeen(payload.userId); // '오늘 접속한 회원' 집계(인메모리) — 체크인 무관
    next();
  } catch {
    next(new UnauthorizedError('유효하지 않은 토큰입니다'));
  }
}

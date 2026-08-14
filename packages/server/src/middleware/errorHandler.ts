import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { captureError } from '../utils/sentry';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: '입력값이 올바르지 않습니다',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  logger.error('Unhandled error:', err);
  // 예상 못 한 500만 Sentry로 — AppError/ZodError는 정상 흐름이라 보내지 않는다.
  captureError(err, { method: req.method, path: req.path });
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
}

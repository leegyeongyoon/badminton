import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { BadRequestError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * 이미지 업로드 (코치 프로필 사진 등).
 *
 * - 인증 필수 + per-user rate limit — 익명 업로드로 디스크를 채우는 것 방지.
 * - 메모리 버퍼로 받아 sharp 로 재인코딩(최대 1024px, WebP) 후에만 디스크에 쓴다.
 *   → 비이미지/악성 파일은 sharp 단계에서 실패해 저장되지 않고, 저장물은 항상
 *   우리가 인코딩한 WebP 라 원본 메타데이터(EXIF 위치 등)도 제거된다.
 * - 파일명은 서버가 만든 uuid 만 사용(클라이언트 파일명/경로 무시 — 경로 주입 방지).
 * - 저장 경로는 UPLOAD_DIR(프로덕션: /app/uploads 도커 볼륨), 로컬 기본값은
 *   packages/server/uploads (.gitignore).
 */

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// 서버 기동 시 1회 보장 — static 마운트와 업로드 양쪽이 쓰는 디렉토리.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'upload:image',
});

router.post(
  '/image',
  authenticate,
  uploadLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file?.buffer?.length) {
        throw new BadRequestError('이미지 파일이 필요합니다 (form field: file)');
      }

      const name = `${randomUUID()}.webp`;
      const dest = path.join(UPLOAD_DIR, name);

      try {
        await sharp(req.file.buffer)
          .rotate() // EXIF orientation 반영(폰 사진 회전 보정)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(dest);
      } catch {
        throw new BadRequestError('이미지를 처리할 수 없습니다. JPG/PNG/WebP 파일인지 확인해주세요');
      }

      logger.info('image_uploaded', { userId: req.user?.userId, file: name, bytes: req.file.size });
      res.status(201).json({ url: `/uploads/${name}` });
    } catch (err) {
      next(err);
    }
  },
);

// multer 자체 에러(용량 초과 등)를 400으로 변환 — 기본은 500으로 새는 문제 방지.
router.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE' ? '이미지는 5MB 이하여야 합니다' : `업로드 오류: ${err.code}`;
    return next(new BadRequestError(msg));
  }
  next(err as Error);
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma';
import { rateLimit } from '../../middleware/rateLimit';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { sendPushToUsers } from '../notification/notification.service';

// ─────────────────────────────────────────────────────────────
// 게스트 사전 신청(공개, 비인증) — 두 진입:
//  • /guest-apply/:inviteCode        — 운영자가 공유한 링크(공개/비공개 무관)
//  • /guest-apply/by-id/:clubId      — '모임 찾기'(인앱 탐색)에서 진입, PUBLIC 모임만
// 로그인 상태로 신청하면(Authorization 헤더) 신청에 userId를 연결해
// 운영자에게 '앱 회원'으로 표시된다. 비로그인도 그대로 신청 가능.
// ─────────────────────────────────────────────────────────────

const router = Router();
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'guest:apply' });

const CLUB_SELECT = {
  id: true,
  name: true,
  description: true,
  guestFee: true,
  duesAccountInfo: true,
  visibility: true,
  homeFacility: { select: { address: true } },
  _count: { select: { members: true } },
} as const;

type ClubPreviewRow = {
  id: string; name: string; description: string | null; guestFee: number | null;
  duesAccountInfo: string | null; visibility: string;
  homeFacility: { address: string } | null; _count: { members: number };
};

function toPreview(club: ClubPreviewRow) {
  return {
    clubId: club.id,
    clubName: club.name,
    description: club.description,
    memberCount: club._count.members,
    region: club.homeFacility?.address ? club.homeFacility.address.split(' ').slice(0, 2).join(' ') : null,
    guestFee: club.guestFee,
    accountInfo: club.duesAccountInfo,
  };
}

/** 초대코드로 조회 — 공유 링크 진입(공개/비공개 무관). */
async function findByInvite(inviteCode: string) {
  return prisma.club.findUnique({
    where: { inviteCode: inviteCode.toUpperCase() },
    select: CLUB_SELECT,
  });
}

/** clubId로 조회 — 탐색 진입. PUBLIC 모임만(비공개는 초대 링크로만). */
async function findPublicById(clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: CLUB_SELECT });
  return club && club.visibility === 'PUBLIC' ? club : null;
}

/** 로그인 상태면 userId 추출(선택적 — 실패해도 익명 신청으로 진행). */
function optionalUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev-secret') as { userId?: string };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

async function handleApply(club: ClubPreviewRow, req: Request, res: Response) {
  const { name, phone, note, skillLevel, gender, visitDate } = req.body as {
    name?: string; phone?: string; note?: string; skillLevel?: string; gender?: string; visitDate?: string;
  };
  // 표준 항목: 이름(필수) · 급수 · 성별 · 참석 희망일. 연락처는 부가(선택).
  const trimmedName = String(name ?? '').trim();
  if (trimmedName.length < 1 || trimmedName.length > 20) throw new BadRequestError('이름을 확인해 주세요');
  const trimmedPhone = String(phone ?? '').replace(/[^0-9]/g, '');
  if (trimmedPhone && !/^01[0-9]{8,9}$/.test(trimmedPhone)) throw new BadRequestError('연락처를 확인해 주세요');
  const validSkill = skillLevel && ['S', 'A', 'B', 'C', 'D', 'E', 'F'].includes(String(skillLevel)) ? String(skillLevel) : null;
  const validGender = gender === 'M' || gender === 'F' ? gender : null;
  const validVisit = visitDate && /^\d{4}-\d{2}-\d{2}$/.test(String(visitDate)) ? String(visitDate) : null;

  const app = await prisma.guestApplication.create({
    data: {
      clubId: club.id,
      name: trimmedName,
      userId: optionalUserId(req),
      skillLevel: validSkill,
      gender: validGender,
      visitDate: validVisit,
      phone: trimmedPhone || null,
      note: note ? String(note).slice(0, 200) : null,
      feeAmount: club.guestFee,
    },
  });

  // 운영진(LEADER/STAFF)에게 신청 접수 푸시(실패해도 신청은 성공).
  try {
    const staff = await prisma.clubMember.findMany({
      where: { clubId: club.id, role: { in: ['LEADER', 'STAFF'] } },
      select: { userId: true },
    });
    const parts = [validSkill && `${validSkill}조`, validGender && (validGender === 'M' ? '남' : '여'), validVisit && `${validVisit.slice(5).replace('-', '/')} 방문`].filter(Boolean).join(' · ');
    await sendPushToUsers(staff.map((s) => s.userId), {
      title: '게스트 신청',
      body: `${trimmedName}님이 신청했어요${parts ? ` (${parts})` : ''} — 모임 관리에서 확인`,
    });
  } catch {
    /* 알림 실패 무시 */
  }

  // 입금 안내(반자동): 계좌·금액을 응답으로 — 신청자 화면에 바로 표시.
  res.status(201).json({
    id: app.id,
    clubName: club.name,
    feeAmount: club.guestFee,
    accountInfo: club.duesAccountInfo,
    message: club.guestFee
      ? `${club.name} 게스트 신청이 접수됐어요. 게스트비 ${club.guestFee.toLocaleString()}원을 입금하시면 확정됩니다.`
      : `${club.name} 게스트 신청이 접수됐어요. 운영자 확인 후 확정됩니다.`,
  });
}

// ── by-id (모임 찾기 진입 — PUBLIC 전용). '/:inviteCode'보다 먼저 선언. ──
router.get('/by-id/:clubId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await findPublicById(String(req.params.clubId));
    if (!club) throw new NotFoundError('모임');
    res.json(toPreview(club));
  } catch (err) {
    next(err);
  }
});

router.post('/by-id/:clubId', applyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await findPublicById(String(req.params.clubId));
    if (!club) throw new NotFoundError('모임');
    await handleApply(club, req, res);
  } catch (err) {
    next(err);
  }
});

// ── 초대코드 (공유 링크 진입) ──
router.get('/:inviteCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await findByInvite(String(req.params.inviteCode));
    if (!club) throw new NotFoundError('모임');
    res.json(toPreview(club));
  } catch (err) {
    next(err);
  }
});

router.post('/:inviteCode', applyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await findByInvite(String(req.params.inviteCode));
    if (!club) throw new NotFoundError('모임');
    await handleApply(club, req, res);
  } catch (err) {
    next(err);
  }
});

export default router;

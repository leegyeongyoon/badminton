import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';
import { rateLimit } from '../../middleware/rateLimit';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { sendPushToUsers } from '../notification/notification.service';

// ─────────────────────────────────────────────────────────────
// 게스트 사전 신청(공개, 비인증) — 실험실 프로토타입.
// 비회원이 공개 링크(초대코드)로 미리 신청 → 입금 안내(계좌·게스트비) 응답 →
// 운영자가 입금확인 후 확정. 현장 QR 셀프 체크인과 별개의 "사전" 단계.
// ─────────────────────────────────────────────────────────────

const router = Router();
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'guest:apply' });

// GET /api/v1/guest-apply/:inviteCode — 신청 폼 표시용 모임 정보(공개).
router.get('/:inviteCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({
      where: { inviteCode: String(req.params.inviteCode).toUpperCase() },
      select: { id: true, name: true, guestFee: true, duesAccountInfo: true },
    });
    if (!club) throw new NotFoundError('모임');
    res.json({ clubId: club.id, clubName: club.name, guestFee: club.guestFee, accountInfo: club.duesAccountInfo });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/guest-apply/:inviteCode — 게스트 사전 신청(공개, rate-limit).
router.post('/:inviteCode', applyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const club = await prisma.club.findUnique({
      where: { inviteCode: String(req.params.inviteCode).toUpperCase() },
      select: { id: true, name: true, guestFee: true, duesAccountInfo: true },
    });
    if (!club) throw new NotFoundError('모임');

    const app = await prisma.guestApplication.create({
      data: {
        clubId: club.id,
        name: trimmedName,
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
  } catch (err) {
    next(err);
  }
});

export default router;

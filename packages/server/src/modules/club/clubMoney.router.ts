import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';
import { verifyClubStaff } from '../clubSession/clubSession.service';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import {
  getClubSettlement,
  getDuesConfig,
  setDuesConfig,
  getClubGuests,
  setGuestFeePaid,
  getClubSessions,
  setSessionRentalCost,
  markDuesPaid,
  unmarkDuesPaid,
  getGuestApplications,
  updateGuestApplication,
  getOperationConfig,
  setOperationConfig,
  getLessonOffers,
  upsertLessonOffer,
  deleteLessonOffer,
  getLessonApplications,
  applyLesson,
  updateLessonApplication,
  isOfferCoach,
  getLessonDetail,
  updateLessonStudent,
  getLessonAttendance,
  setLessonAttendance,
  promoteFromWaitlist,
  getLessonBilling,
  getLessonFees,
  confirmLessonFee,
  unconfirmLessonFee,
  issueLessonShareLink,
  addLessonStudent,
  remindLessonFees,
  sendLessonNotice,
} from '../lab/lab.service';
import { payLessonFee, cancelLessonPayment } from '../payment/payment.service';
import * as guestChat from '../guestChat/guestChat.service';
import { getMyDues, getMoneyStats } from '../lab/lab.service';

// ─────────────────────────────────────────────────────────────
// 모임 회비 관리(정식) — 실험실에서 검증된 로직(lab.service)을 모임 운영진
// (LEADER/STAFF) 권한으로 승격한 라우터. /clubs/:clubId/money/* 프리픽스로
// 기존 club.router 경로와 충돌 없이 마운트한다.
// ─────────────────────────────────────────────────────────────

const router = Router();

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 공통: LEADER/STAFF(또는 SUPER_ADMIN) 가드.
async function staffGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    await verifyClubStaff(String(req.params.clubId), req.user!.userId);
    next();
  } catch (err) {
    next(err);
  }
}

// GET /clubs/:clubId/money/settlement?period
router.get('/:clubId/money/settlement', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSettlement(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// GET/PUT /clubs/:clubId/money/config — 회비·게스트비 설정
router.get('/:clubId/money/config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getDuesConfig(String(req.params.clubId))); } catch (err) { next(err); }
});
router.put('/:clubId/money/config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setDuesConfig(String(req.params.clubId), req.body || {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET/PUT /clubs/:clubId/money/operation-config — 운영 정보(운동 일정·게스트 신청 정책)
router.get('/:clubId/money/operation-config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getOperationConfig(String(req.params.clubId))); } catch (err) { next(err); }
});
router.put('/:clubId/money/operation-config', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setOperationConfig(String(req.params.clubId), req.body || {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/guests?period — 게스트 목록(게스트비)
router.get('/:clubId/money/guests', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubGuests(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/sessions?period — 정모 목록(대관비 엔빵)
router.get('/:clubId/money/sessions', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || '') || defaultPeriod();
    res.json(await getClubSessions(String(req.params.clubId), period));
  } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/sessions/:sessionId/rental-cost — 소유권 확인 후 설정
router.put('/:clubId/money/sessions/:sessionId/rental-cost', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.clubSession.findUnique({
      where: { id: String(req.params.sessionId) },
      select: { clubId: true },
    });
    if (!session || session.clubId !== String(req.params.clubId)) throw new NotFoundError('정모');
    const { cost } = req.body as { cost?: number | null };
    await setSessionRentalCost(String(req.params.sessionId), cost != null && Number(cost) > 0 ? Number(cost) : null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST/DELETE /clubs/:clubId/money/dues-payment — 입금확인 원클릭
router.post('/:clubId/money/dues-payment', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period, amount } = req.body as { userId?: string; period?: string; amount?: number };
    if (!userId || !period) throw new BadRequestError('userId, period 필요');
    await markDuesPaid(String(req.params.clubId), userId, period, Number(amount) || 0, req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.delete('/:clubId/money/dues-payment', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, period } = req.body as { userId?: string; period?: string };
    if (!userId || !period) throw new BadRequestError('userId, period 필요');
    await unmarkDuesPaid(String(req.params.clubId), userId, period);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/guest-applications — 사전 신청 목록
router.get('/:clubId/money/guest-applications', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getGuestApplications(String(req.params.clubId))); } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/guest-applications/:appId — 소유권 확인 후 갱신
router.put('/:clubId/money/guest-applications/:appId', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await prisma.guestApplication.findUnique({
      where: { id: String(req.params.appId) },
      select: { clubId: true },
    });
    if (!app || app.clubId !== String(req.params.clubId)) throw new NotFoundError('신청');
    const { feePaid, status } = req.body as { feePaid?: boolean; status?: string };
    await updateGuestApplication(String(req.params.appId), { feePaid, status });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/checkins/:checkInId/fee-paid — 소유권 확인 후 게스트비 납부 토글
router.put('/:clubId/money/checkins/:checkInId/fee-paid', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ci = await prisma.checkIn.findUnique({
      where: { id: String(req.params.checkInId) },
      select: { clubSession: { select: { clubId: true } } },
    });
    if (!ci || ci.clubSession?.clubId !== String(req.params.clubId)) throw new NotFoundError('체크인');
    const { paid } = req.body as { paid?: boolean };
    await setGuestFeePaid(String(req.params.checkInId), !!paid);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 레슨 중개 MVP ────────────────────────────────────────────

// GET /clubs/:clubId/money/lessons — 레슨 상품 목록(운영자, 비활성 포함)
router.get('/:clubId/money/lessons', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getLessonOffers(String(req.params.clubId))); } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/lessons — 생성/수정(id 있으면 수정, 소유권 확인)
router.put('/:clubId/money/lessons', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body || {}) as Parameters<typeof upsertLessonOffer>[1];
    if (body.id) {
      const offer = await prisma.lessonOffer.findUnique({ where: { id: String(body.id) }, select: { clubId: true } });
      if (!offer || offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨');
    }
    const id = await upsertLessonOffer(String(req.params.clubId), body);
    res.json({ ok: true, id });
  } catch (err) { next(err); }
});

// DELETE /clubs/:clubId/money/lessons/:offerId — 소유권 확인 후 삭제
router.delete('/:clubId/money/lessons/:offerId', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await prisma.lessonOffer.findUnique({ where: { id: String(req.params.offerId) }, select: { clubId: true } });
    if (!offer || offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨');
    await deleteLessonOffer(String(req.params.offerId));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 레슨 상세: 로스터·회차 출석 — 운영진 또는 "담당 코치 본인" ───
// 코치는 그 클럽 staff 가 아니어도 자기 레슨의 수강생·출석은 관리할 수 있어야 한다.
async function staffOrLessonCoach(req: Request, _res: Response, next: NextFunction) {
  try {
    const offerId = String(req.params.offerId);
    const offer = await prisma.lessonOffer.findUnique({ where: { id: offerId }, select: { clubId: true } });
    if (!offer || offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨');
    try {
      await verifyClubStaff(String(req.params.clubId), req.user!.userId);
      return next();
    } catch {
      if (await isOfferCoach(offerId, req.user!.userId)) return next();
      throw new NotFoundError('레슨');
    }
  } catch (err) {
    next(err);
  }
}

// GET /clubs/:clubId/money/lessons/:offerId — 레슨 상세(코치 헤더 + 로스터)
router.get('/:clubId/money/lessons/:offerId', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getLessonDetail(String(req.params.offerId), req.user!.userId)); } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/lessons/:offerId/students/:appId — 수강 상태·메모
router.put('/:clubId/money/lessons/:offerId/students/:appId', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await prisma.lessonApplication.findUnique({
      where: { id: String(req.params.appId) },
      select: { offerId: true },
    });
    if (!app || app.offerId !== String(req.params.offerId)) throw new NotFoundError('수강생');
    const { enrollState, note } = req.body as { enrollState?: string; note?: string | null };
    await updateLessonStudent(String(req.params.appId), { enrollState, note });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/waitlist/:appId/promote — 대기 풀기(승급)
router.post('/:clubId/money/lessons/:offerId/waitlist/:appId/promote', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await promoteFromWaitlist(String(req.params.offerId), String(req.params.appId));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/lessons/:offerId/billing — 이번 달 정산 요약(수수료·지급 예정)
router.get('/:clubId/money/lessons/:offerId/billing', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLessonBilling(String(req.params.offerId)));
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/lessons/:offerId/attendance?date=YYYY-MM-DD — 그 날짜 출석
router.get('/:clubId/money/lessons/:offerId/attendance', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLessonAttendance(String(req.params.offerId), String(req.query.date || '')));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/attendance {date, entries:[{applicationId,present}]}
router.post('/:clubId/money/lessons/:offerId/attendance', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, entries } = req.body as { date?: string; entries?: { applicationId: string; present: boolean }[] };
    await setLessonAttendance(String(req.params.offerId), String(date || ''), entries ?? []);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/lesson-applications — 신청 목록(운영자)
router.get('/:clubId/money/lesson-applications', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getLessonApplications(String(req.params.clubId))); } catch (err) { next(err); }
});

// PUT /clubs/:clubId/money/lesson-applications/:appId — 확정/취소(소유권 확인)
router.put('/:clubId/money/lesson-applications/:appId', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await prisma.lessonApplication.findUnique({
      where: { id: String(req.params.appId) },
      select: { offer: { select: { clubId: true } } },
    });
    if (!app || app.offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨 신청');
    const { status, feePaid } = req.body as { status?: string; feePaid?: boolean };
    if (status === undefined && feePaid === undefined) throw new BadRequestError('status 또는 feePaid 필요');
    await updateLessonApplication(String(req.params.appId), { status, feePaid }, req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 레슨비 월 수납(수동 입금확인) — 운영진 또는 담당 코치 ───

// GET /clubs/:clubId/money/lessons/:offerId/fees?period=YYYY-MM — 월별 수납 현황
router.get('/:clubId/money/lessons/:offerId/fees', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLessonFees(String(req.params.offerId), String(req.query.period || '')));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/fees/confirm {applicationId, period} — 입금 확인
router.post('/:clubId/money/lessons/:offerId/fees/confirm', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, period } = req.body as { applicationId?: string; period?: string };
    await confirmLessonFee(String(req.params.offerId), String(applicationId || ''), String(period || ''), req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /clubs/:clubId/money/lessons/:offerId/fees/confirm {applicationId, period} — 확인 해제
router.delete('/:clubId/money/lessons/:offerId/fees/confirm', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, period } = req.body as { applicationId?: string; period?: string };
    await unconfirmLessonFee(String(req.params.offerId), String(applicationId || ''), String(period || ''));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/share-link {regenerate?} — 무설치 납부 페이지 링크
router.post('/:clubId/money/lessons/:offerId/share-link', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { regenerate } = req.body as { regenerate?: boolean };
    res.json(await issueLessonShareLink(String(req.params.offerId), !!regenerate));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/students {name, phone?} — 수기 수강생 추가(앱 미가입 반원)
router.post('/:clubId/money/lessons/:offerId/students', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone } = req.body as { name?: string; phone?: string };
    res.json(await addLessonStudent(String(req.params.offerId), { name, phone }));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/notice {message} — 레슨 공지(휴강·보강, 코치·운영진)
router.post('/:clubId/money/lessons/:offerId/notice', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body as { message?: string };
    res.json(await sendLessonNotice(String(req.params.offerId), String(message || '')));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/money/lessons/:offerId/fees/remind {period} — 미납 독촉(회원 푸시 + 공유 문구)
router.post('/:clubId/money/lessons/:offerId/fees/remind', authenticate, staffOrLessonCoach, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period } = req.body as { period?: string };
    res.json(await remindLessonFees(String(req.params.offerId), String(period || '')));
  } catch (err) { next(err); }
});

// ─── 회원용 레슨(스태프 아님 — 멤버 가드) ──────────────────────
async function memberGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const member = await prisma.clubMember.findFirst({
      where: { clubId: String(req.params.clubId), userId: req.user!.userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundError('모임');
    next();
  } catch (err) {
    next(err);
  }
}

// GET /clubs/:clubId/lessons — 활성 레슨 목록(회원)
router.get('/:clubId/lessons', authenticate, memberGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getLessonOffers(String(req.params.clubId), true, req.user!.userId)); } catch (err) { next(err); }
});

// POST /clubs/:clubId/lessons/:offerId/apply — 회원 레슨 신청
router.post('/:clubId/lessons/:offerId/apply', authenticate, memberGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await prisma.lessonOffer.findUnique({ where: { id: String(req.params.offerId) }, select: { clubId: true } });
    if (!offer || offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨');
    const me = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true, phone: true } });
    const { note } = req.body as { note?: string };
    const result = await applyLesson(String(req.params.offerId), {
      userId: req.user!.userId,
      name: me?.name || '회원',
      phone: me?.phone ?? null,
      note: note ?? null,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/lessons/:offerId/pay — 회원 레슨비 결제(임시 MOCK, env 게이트)
router.post('/:clubId/lessons/:offerId/pay', authenticate, memberGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await prisma.lessonOffer.findUnique({ where: { id: String(req.params.offerId) }, select: { clubId: true } });
    if (!offer || offer.clubId !== String(req.params.clubId)) throw new NotFoundError('레슨');
    const { period, methodId } = req.body as { period?: string; methodId?: string };
    res.status(201).json(await payLessonFee(String(req.params.offerId), req.user!.userId, { period, methodId }));
  } catch (err) { next(err); }
});

// POST /clubs/:clubId/lessons/:offerId/pay/cancel — 당월 결제 취소(본인)
router.post('/:clubId/lessons/:offerId/pay/cancel', authenticate, memberGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period } = req.body as { period?: string };
    const app = await prisma.lessonApplication.findFirst({
      where: { offerId: String(req.params.offerId), userId: req.user!.userId },
      select: { id: true },
    });
    if (!app) throw new NotFoundError('수강');
    await cancelLessonPayment(String(req.params.offerId), app.id, String(period || '') || new Date().toISOString().slice(0, 7));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 게스트 문의함(운영진) ─────────────────────────────────────
// GET /clubs/:clubId/guest-threads — 문의 스레드 목록(미읽음 포함)
router.get('/:clubId/money/guest-threads', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await guestChat.listStaffThreads(String(req.params.clubId))); } catch (err) { next(err); }
});

// GET /clubs/:clubId/guest-threads/unread-count — 뱃지용 미읽음 스레드 수
router.get('/:clubId/money/guest-threads/unread-count', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ count: await guestChat.countStaffUnreadThreads(String(req.params.clubId)) }); } catch (err) { next(err); }
});

// GET /clubs/:clubId/guest-threads/:threadId — 스레드 대화(소유권 확인)
router.get('/:clubId/money/guest-threads/:threadId', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await guestChat.loadThreadForStaff(String(req.params.clubId), String(req.params.threadId))); } catch (err) { next(err); }
});

// POST /clubs/:clubId/guest-threads/:threadId/messages — 운영진 답장
router.post('/:clubId/money/guest-threads/:threadId/messages', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body as { text?: string };
    const msg = await guestChat.staffSendMessage(String(req.params.clubId), String(req.params.threadId), req.user!.userId, String(text ?? ''));
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

// PUT /clubs/:clubId/guest-threads/:threadId/closed — 종료/재개
router.put('/:clubId/money/guest-threads/:threadId/closed', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { closed } = req.body as { closed?: boolean };
    await guestChat.setThreadClosed(String(req.params.clubId), String(req.params.threadId), !!closed);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 회원용 "내 회비" + 운영자 통계 ───────────────────────────
// GET /clubs/:clubId/my-dues — 내 기간별 청구/납부 타임라인(멤버 본인)
router.get('/:clubId/my-dues', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const member = await prisma.clubMember.findFirst({
      where: { clubId: String(req.params.clubId), userId: req.user!.userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundError('모임');
    res.json(await getMyDues(String(req.params.clubId), req.user!.userId));
  } catch (err) { next(err); }
});

// GET /clubs/:clubId/money/stats — 월별 청구/납부 추이(운영자)
router.get('/:clubId/money/stats', authenticate, staffGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const months = Math.min(12, Math.max(3, parseInt(String(req.query.months || '6'), 10) || 6));
    res.json(await getMoneyStats(String(req.params.clubId), months));
  } catch (err) { next(err); }
});

export default router;

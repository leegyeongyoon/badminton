import { prisma } from '../../utils/prisma';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../utils/errors';
import { sendPushToUser } from '../notification/notification.service';
import { logger } from '../../utils/logger';
import { provider, applyDeclineMarker, ProviderError, type CardInput } from './provider';
import { PLATFORM_FEE_RATE, currentPeriod } from '../lab/lab.service';

// ─────────────────────────────────────────────────────────────
// 결제·정산 서비스 — 실운영 flow 의 Mock 구동.
//  카드 등록(빌링키) → 결제(수동/자동 청구) → 플랫폼 수납 원장(LessonPayment)
//  → 월 마감(코치별 CoachPayout 배치) → 지급 실행.
// 전부 PAYMENTS_MOCK=1 게이트 뒤 — 프로덕션은 자동 차단.
// ─────────────────────────────────────────────────────────────

export function assertPaymentsEnabled(): void {
  if (process.env.PAYMENTS_MOCK !== '1') {
    throw new BadRequestError('결제 기능은 준비 중이에요.');
  }
}

// ── 카드(결제 수단) ──────────────────────────────────────────

export interface PaymentMethodDTO {
  id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpiry: string;
  isDefault: boolean;
  createdAt: string;
}

const toMethodDTO = (m: { id: string; cardBrand: string; cardLast4: string; cardExpiry: string; isDefault: boolean; createdAt: Date }): PaymentMethodDTO => ({
  id: m.id, cardBrand: m.cardBrand, cardLast4: m.cardLast4, cardExpiry: m.cardExpiry, isDefault: m.isDefault, createdAt: m.createdAt.toISOString(),
});

export async function registerCard(userId: string, card: CardInput): Promise<PaymentMethodDTO> {
  assertPaymentsEnabled();
  let issued;
  try {
    issued = applyDeclineMarker(await provider.issueBillingKey(card));
  } catch (e) {
    if (e instanceof ProviderError) throw new BadRequestError(e.message);
    throw e;
  }
  const count = await prisma.paymentMethod.count({ where: { userId, deletedAt: null } });
  const method = await prisma.paymentMethod.create({
    data: {
      userId,
      provider: provider.name,
      billingKey: issued.billingKey,
      cardBrand: issued.cardBrand,
      cardLast4: issued.cardLast4,
      cardExpiry: issued.cardExpiry,
      isDefault: count === 0, // 첫 카드는 기본
    },
  });
  return toMethodDTO(method);
}

export async function listCards(userId: string): Promise<PaymentMethodDTO[]> {
  assertPaymentsEnabled();
  const rows = await prisma.paymentMethod.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toMethodDTO);
}

export async function deleteCard(userId: string, methodId: string): Promise<void> {
  assertPaymentsEnabled();
  const m = await prisma.paymentMethod.findUnique({ where: { id: methodId } });
  if (!m || m.userId !== userId || m.deletedAt) throw new NotFoundError('결제 수단');
  await prisma.paymentMethod.update({ where: { id: methodId }, data: { deletedAt: new Date(), isDefault: false } });
  // 기본 카드가 지워졌으면 남은 최신 카드를 기본으로.
  if (m.isDefault) {
    const next = await prisma.paymentMethod.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    if (next) await prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

export async function setDefaultCard(userId: string, methodId: string): Promise<void> {
  assertPaymentsEnabled();
  const m = await prisma.paymentMethod.findUnique({ where: { id: methodId } });
  if (!m || m.userId !== userId || m.deletedAt) throw new NotFoundError('결제 수단');
  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { userId }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: methodId }, data: { isDefault: true } }),
  ]);
}

// ── 결제(수동 + 자동 청구) ───────────────────────────────────

async function chargeApplication(
  app: { id: string; userId: string | null; offerId: string },
  offer: { fee: number; coachName: string },
  period: string,
  methodId?: string,
): Promise<{ ok: boolean; paymentId: string; failReason?: string }> {
  const method = methodId
    ? await prisma.paymentMethod.findFirst({ where: { id: methodId, userId: app.userId ?? '', deletedAt: null } })
    : await prisma.paymentMethod.findFirst({ where: { userId: app.userId ?? '', deletedAt: null, isDefault: true } });
  if (!method) throw new BadRequestError('등록된 결제 카드가 없어요. 결제 수단을 먼저 등록해 주세요.');

  const feeAmount = Math.round(offer.fee * PLATFORM_FEE_RATE);
  const orderName = `${period.slice(5)}월 ${offer.coachName} 코치 레슨비`;
  const base = {
    amount: offer.fee,
    feeAmount,
    payout: offer.fee - feeAmount,
    provider: provider.name,
    paymentMethodId: method.id,
    orderName,
    paidAt: new Date(),
  };

  try {
    const { txId } = await provider.chargeBilling(method.billingKey, offer.fee, orderName);
    const payment = await prisma.lessonPayment.upsert({
      where: { applicationId_period: { applicationId: app.id, period } },
      create: { applicationId: app.id, offerId: app.offerId, period, ...base, pgTxId: txId, status: 'PAID', failReason: null },
      update: { ...base, pgTxId: txId, status: 'PAID', failReason: null },
    });
    await prisma.lessonApplication.update({ where: { id: app.id }, data: { feePaid: true } });
    return { ok: true, paymentId: payment.id };
  } catch (e) {
    const reason = e instanceof ProviderError ? e.message : '결제 처리 중 오류가 발생했어요';
    const payment = await prisma.lessonPayment.upsert({
      where: { applicationId_period: { applicationId: app.id, period } },
      create: { applicationId: app.id, offerId: app.offerId, period, ...base, pgTxId: null, status: 'FAILED', failReason: reason },
      update: { ...base, pgTxId: null, status: 'FAILED', failReason: reason },
    });
    return { ok: false, paymentId: payment.id, failReason: reason };
  }
}

/** 회원 수동 결제 — 확정·미종료 수강생 본인, 카드 선택 가능(기본 카드 기본값). */
export async function payLessonFee(
  offerId: string,
  userId: string,
  opts?: { period?: string; methodId?: string },
): Promise<{ paymentId: string; amount: number; period: string; message: string }> {
  assertPaymentsEnabled();
  const period = opts?.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.period) ? opts.period : currentPeriod();

  const offer = await prisma.lessonOffer.findUnique({ where: { id: offerId }, select: { fee: true, coachName: true } });
  if (!offer) throw new NotFoundError('레슨');
  if (!offer.fee || offer.fee <= 0) throw new BadRequestError('이 레슨은 레슨비가 설정돼 있지 않아요.');

  const app = await prisma.lessonApplication.findFirst({
    where: { offerId, userId, status: 'CONFIRMED' },
    select: { id: true, userId: true, offerId: true, enrollState: true },
  });
  if (!app) throw new BadRequestError('확정된 수강생만 결제할 수 있어요.');
  if (app.enrollState === 'ENDED') throw new BadRequestError('종료된 수강은 결제할 수 없어요.');

  const existing = await prisma.lessonPayment.findUnique({
    where: { applicationId_period: { applicationId: app.id, period } },
  });
  if (existing?.status === 'PAID') throw new BadRequestError('이번 달 레슨비는 이미 결제됐어요.');

  const result = await chargeApplication(app, { fee: offer.fee, coachName: offer.coachName }, period, opts?.methodId);
  if (!result.ok) throw new BadRequestError(result.failReason ?? '결제가 거절됐어요.');

  return {
    paymentId: result.paymentId,
    amount: offer.fee,
    period,
    message: `${offer.coachName} 코치 ${period.slice(5)}월 레슨비 ${offer.fee.toLocaleString()}원 결제 완료`,
  };
}

/** 결제 취소(환불) — 본인 또는 운영진(라우터에서 판단 후 호출). feePaid 롤백. */
export async function cancelLessonPayment(offerId: string, applicationId: string, period: string): Promise<void> {
  assertPaymentsEnabled();
  const payment = await prisma.lessonPayment.findUnique({
    where: { applicationId_period: { applicationId, period } },
  });
  if (!payment || payment.offerId !== offerId || payment.status !== 'PAID') throw new NotFoundError('결제');
  if (payment.pgTxId) {
    try {
      await provider.cancel(payment.pgTxId);
    } catch (e) {
      if (e instanceof ProviderError) throw new BadRequestError(e.message);
      throw e;
    }
  }
  await prisma.lessonPayment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
  await prisma.lessonApplication.update({ where: { id: applicationId }, data: { feePaid: false } });
}

/**
 * 자동 청구(정기결제) — 당월 미결제인 CONFIRMED·미종료·기본 카드 보유 수강생 전원.
 * unique(applicationId, period) 로 idempotent. 성공/실패 푸시.
 * 실서비스에선 매월 1일 크론 + PG 웹훅으로 대체되는 지점.
 */
export async function runMonthlyBilling(period?: string): Promise<{ period: string; charged: number; failed: number; skippedNoCard: number }> {
  assertPaymentsEnabled();
  const per = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : currentPeriod();

  const targets = await prisma.lessonApplication.findMany({
    where: {
      status: 'CONFIRMED',
      enrollState: { not: 'ENDED' },
      userId: { not: null },
      offer: { enabled: true, fee: { gt: 0 } },
      payments: { none: { period: per, status: 'PAID' } },
    },
    include: { offer: { select: { fee: true, coachName: true } } },
  });

  let charged = 0;
  let failed = 0;
  let skippedNoCard = 0;
  for (const app of targets) {
    const hasCard = await prisma.paymentMethod.findFirst({ where: { userId: app.userId!, deletedAt: null, isDefault: true } });
    if (!hasCard) {
      skippedNoCard++;
      continue;
    }
    const r = await chargeApplication(
      { id: app.id, userId: app.userId, offerId: app.offerId },
      { fee: app.offer.fee!, coachName: app.offer.coachName },
      per,
    );
    if (r.ok) {
      charged++;
      try {
        await sendPushToUser(app.userId!, {
          title: '레슨비 자동 결제 완료',
          body: `${app.offer.coachName} 코치 ${per.slice(5)}월 레슨비 ${app.offer.fee!.toLocaleString()}원이 결제됐어요`,
          data: { type: 'lessonAutoPay', offerId: app.offerId },
        });
      } catch { /* 알림 실패 무시 */ }
    } else {
      failed++;
      try {
        await sendPushToUser(app.userId!, {
          title: '레슨비 결제 실패 ⚠️',
          body: `${r.failReason} — 결제 수단을 확인하고 다시 시도해 주세요`,
          data: { type: 'lessonAutoPayFailed', offerId: app.offerId },
        });
      } catch { /* 알림 실패 무시 */ }
    }
  }
  logger.info('lesson_auto_billing', { period: per, charged, failed, skippedNoCard });
  return { period: per, charged, failed, skippedNoCard };
}

// 서버 기동 시 1시간 주기 자동 청구 틱(멱등이라 안전). PAYMENTS_MOCK 아닐 땐 no-op.
export function startBillingLoop(): void {
  if (process.env.PAYMENTS_MOCK !== '1') return;
  setInterval(() => {
    runMonthlyBilling().catch((e) => logger.warn('auto_billing_tick_failed', { error: String(e) }));
  }, 60 * 60 * 1000);
  logger.info('mock_billing_loop_started');
}

/** 내 결제 내역(회원) — 최신순. */
export interface PaymentHistoryRow {
  id: string;
  period: string;
  orderName: string | null;
  amount: number;
  status: string;
  failReason: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  paidAt: string;
}

export async function getMyPayments(userId: string): Promise<PaymentHistoryRow[]> {
  assertPaymentsEnabled();
  const rows = await prisma.lessonPayment.findMany({
    where: { application: { userId } },
    orderBy: { paidAt: 'desc' },
    take: 100,
    include: { paymentMethod: { select: { cardBrand: true, cardLast4: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    period: p.period,
    orderName: p.orderName,
    amount: p.amount,
    status: p.status,
    failReason: p.failReason,
    cardLast4: p.paymentMethod?.cardLast4 ?? null,
    cardBrand: p.paymentMethod?.cardBrand ?? null,
    paidAt: p.paidAt.toISOString(),
  }));
}

// ── 정산(코치 지급) ──────────────────────────────────────────

export interface CoachPayoutDTO {
  id: string;
  coachProfileId: string;
  coachName: string;
  period: string;
  totalAmount: number;
  feeAmount: number;
  payoutAmount: number;
  paymentCount: number;
  bankSnapshot: string | null;
  status: string;
  paidAt: string | null;
}

const toPayoutDTO = (p: { id: string; coachProfileId: string; period: string; totalAmount: number; feeAmount: number; payoutAmount: number; paymentCount: number; bankSnapshot: string | null; status: string; paidAt: Date | null }, coachName: string): CoachPayoutDTO => ({
  id: p.id, coachProfileId: p.coachProfileId, coachName, period: p.period,
  totalAmount: p.totalAmount, feeAmount: p.feeAmount, payoutAmount: p.payoutAmount,
  paymentCount: p.paymentCount, bankSnapshot: p.bankSnapshot, status: p.status,
  paidAt: p.paidAt?.toISOString() ?? null,
});

/** 월 마감 — 코치별 당월 PAID 결제를 합산해 정산 배치(PENDING) upsert. */
export async function closeSettlement(period?: string): Promise<{ period: string; batches: CoachPayoutDTO[]; unlinkedCount: number; unlinkedAmount: number }> {
  assertPaymentsEnabled();
  const per = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : currentPeriod();

  // 코치 연결된 레슨의 당월 PAID 결제만 배치 대상(미연결 레슨은 지급 상대가 없음).
  const payments = await prisma.lessonPayment.findMany({
    where: { period: per, status: 'PAID' },
    include: { application: { select: { offer: { select: { coachProfileId: true } } } } },
  });

  const byCoach = new Map<string, { total: number; fee: number; payout: number; count: number }>();
  let unlinkedCount = 0;
  let unlinkedAmount = 0;
  for (const p of payments) {
    const cid = p.application.offer.coachProfileId;
    if (!cid) {
      unlinkedCount += 1;
      unlinkedAmount += p.amount;
      continue;
    }
    const acc = byCoach.get(cid) ?? { total: 0, fee: 0, payout: 0, count: 0 };
    acc.total += p.amount;
    acc.fee += p.feeAmount;
    acc.payout += p.payout;
    acc.count += 1;
    byCoach.set(cid, acc);
  }

  const batches: CoachPayoutDTO[] = [];
  for (const [coachProfileId, acc] of byCoach) {
    const coach = await prisma.coachProfile.findUnique({
      where: { id: coachProfileId },
      select: { displayName: true, bankName: true, bankAccount: true, bankHolder: true },
    });
    if (!coach) continue;
    const bankSnapshot = coach.bankName && coach.bankAccount
      ? `${coach.bankName} ${coach.bankAccount} ${coach.bankHolder ?? ''}`.trim()
      : null;
    const row = await prisma.coachPayout.upsert({
      where: { coachProfileId_period: { coachProfileId, period: per } },
      create: { coachProfileId, period: per, totalAmount: acc.total, feeAmount: acc.fee, payoutAmount: acc.payout, paymentCount: acc.count, bankSnapshot },
      // 이미 지급(PAID)된 배치는 재마감으로 덮지 않는다.
      update: {},
    });
    const fresh = row.status === 'PENDING'
      ? await prisma.coachPayout.update({
          where: { id: row.id },
          data: { totalAmount: acc.total, feeAmount: acc.fee, payoutAmount: acc.payout, paymentCount: acc.count, bankSnapshot },
        })
      : row;
    batches.push(toPayoutDTO(fresh, coach.displayName));
  }
  return { period: per, batches, unlinkedCount, unlinkedAmount };
}

/** 지급 실행 — PENDING 배치를 지급 처리(mock 이체). 계좌 미등록이면 거절. */
export async function executePayout(payoutId: string): Promise<CoachPayoutDTO> {
  assertPaymentsEnabled();
  const payout = await prisma.coachPayout.findUnique({
    where: { id: payoutId },
    include: { coachProfile: { select: { displayName: true, userId: true, bankName: true, bankAccount: true, bankHolder: true } } },
  });
  if (!payout) throw new NotFoundError('정산 배치');
  if (payout.status === 'PAID') throw new BadRequestError('이미 지급된 배치예요.');

  const bankSnapshot = payout.bankSnapshot
    ?? (payout.coachProfile.bankName && payout.coachProfile.bankAccount
      ? `${payout.coachProfile.bankName} ${payout.coachProfile.bankAccount} ${payout.coachProfile.bankHolder ?? ''}`.trim()
      : null);
  if (!bankSnapshot) throw new BadRequestError('코치의 정산 계좌가 등록되지 않아 지급할 수 없어요.');

  // (실 PG/지급대행 연동 지점) — 여기서 이체 API 호출. MOCK 은 즉시 성공.
  const updated = await prisma.coachPayout.update({
    where: { id: payoutId },
    data: { status: 'PAID', paidAt: new Date(), bankSnapshot },
  });
  try {
    await sendPushToUser(payout.coachProfile.userId, {
      title: '정산금 지급 완료 💸',
      body: `${payout.period.slice(5)}월 정산 ${payout.payoutAmount.toLocaleString()}원이 지급됐어요`,
      data: { type: 'coachPayoutPaid', payoutId },
    });
  } catch { /* 알림 실패 무시 */ }
  return toPayoutDTO(updated, payout.coachProfile.displayName);
}

/** 코치 본인 지급 내역. */
export async function getMyPayouts(userId: string): Promise<CoachPayoutDTO[]> {
  assertPaymentsEnabled();
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true, displayName: true } });
  if (!profile) return [];
  const rows = await prisma.coachPayout.findMany({
    where: { coachProfileId: profile.id },
    orderBy: { period: 'desc' },
    take: 24,
  });
  return rows.map((r) => toPayoutDTO(r, profile.displayName));
}

/** 코치 정산 계좌 등록. */
export async function setCoachBank(userId: string, input: { bankName?: string; bankAccount?: string; bankHolder?: string }): Promise<void> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new BadRequestError('코치 프로필이 필요해요.');
  const bankName = String(input.bankName ?? '').trim().slice(0, 30);
  const bankAccount = String(input.bankAccount ?? '').trim().slice(0, 40);
  const bankHolder = String(input.bankHolder ?? '').trim().slice(0, 20);
  if (!bankName || !bankAccount || !bankHolder) throw new BadRequestError('은행·계좌번호·예금주를 모두 입력해 주세요.');
  await prisma.coachProfile.update({ where: { id: profile.id }, data: { bankName, bankAccount, bankHolder } });
}

/** 플랫폼 월 요약(최고관리자) — 수납·수수료 수익·지급 현황. */
export interface PlatformSummary {
  period: string;
  grossPaid: number; // 수납 총액
  feeRevenue: number; // 플랫폼 수수료 수익
  paymentCount: number;
  failedCount: number;
  payoutPending: number; // 미지급 배치 합계
  payoutPaid: number; // 지급 완료 합계
  batches: CoachPayoutDTO[];
}

export async function getPlatformSummary(period?: string): Promise<PlatformSummary> {
  assertPaymentsEnabled();
  const per = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : currentPeriod();
  const [paidAgg, failedCount, batches] = await Promise.all([
    prisma.lessonPayment.aggregate({ where: { period: per, status: 'PAID' }, _sum: { amount: true, feeAmount: true }, _count: true }),
    prisma.lessonPayment.count({ where: { period: per, status: 'FAILED' } }),
    prisma.coachPayout.findMany({ where: { period: per }, include: { coachProfile: { select: { displayName: true } } } }),
  ]);
  return {
    period: per,
    grossPaid: paidAgg._sum.amount ?? 0,
    feeRevenue: paidAgg._sum.feeAmount ?? 0,
    paymentCount: paidAgg._count,
    failedCount,
    payoutPending: batches.filter((b) => b.status === 'PENDING').reduce((s, b) => s + b.payoutAmount, 0),
    payoutPaid: batches.filter((b) => b.status === 'PAID').reduce((s, b) => s + b.payoutAmount, 0),
    batches: batches.map((b) => toPayoutDTO(b, b.coachProfile.displayName)),
  };
}

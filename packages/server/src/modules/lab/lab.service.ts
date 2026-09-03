import { randomUUID } from 'crypto';
import { prisma } from '../../utils/prisma';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { sendPushToUser } from '../notification/notification.service';
import type {
  LabProfileResponse,
  LabBadge,
  LabPartnerItem,
  LabSettlementResponse,
  LabSettlementMember,
} from '@badminton/shared';

// ─────────────────────────────────────────────────────────────
// 실험실(Lab) 서비스 — 최고관리자 전용 상용 프로토타입.
// 전부 기존 데이터(GamePlayer/CheckIn/DuesPayment/ClubMember) 파생. 스키마 무변경.
// ─────────────────────────────────────────────────────────────

const NOT_CANCELLED = { status: { not: 'CANCELLED' as const } };

/** 연속 출석 일수(오늘 미플레이는 끊김으로 보지 않음). user.service getTotalStats와 동일 규칙. */
async function computeStreak(userId: string): Promise<number> {
  const now = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    const count = await prisma.gamePlayer.count({
      where: { userId, game: { createdAt: { gte: start, lte: end }, ...NOT_CANCELLED } },
    });
    if (count > 0) streak++;
    else if (i === 0) continue; // 오늘 아직 안 침 — 어제부터 이어세기
    else break;
  }
  return streak;
}

/** 개인 크로스클럽 프로필 — 총게임·이번달·스트릭·모임별·파트너 랭킹·뱃지. */
export async function getLabProfile(userId: string): Promise<LabProfileResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, profile: { select: { skillLevel: true } } },
  });
  if (!user) throw new Error('User not found');

  // 내가 뛴 게임(취소 제외) — 모임/생성일 포함.
  const myGames = await prisma.gamePlayer.findMany({
    where: { userId, game: NOT_CANCELLED },
    select: {
      gameId: true,
      game: {
        select: {
          createdAt: true,
          turn: {
            select: { clubSession: { select: { clubId: true, club: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  const totalGames = myGames.length;
  const startOfMonth = new Date();
  startOfMonth.setHours(0, 0, 0, 0);
  startOfMonth.setDate(1);
  const thisMonthGames = myGames.filter((g) => g.game.createdAt >= startOfMonth).length;

  // 모임별 게임수.
  const clubMap = new Map<string, { clubName: string; games: number }>();
  for (const g of myGames) {
    const cs = g.game.turn?.clubSession;
    if (!cs) continue;
    const cur = clubMap.get(cs.clubId) ?? { clubName: cs.club.name, games: 0 };
    cur.games++;
    clubMap.set(cs.clubId, cur);
  }
  const clubGames = Array.from(clubMap.entries())
    .map(([clubId, v]) => ({ clubId, clubName: v.clubName, games: v.games }))
    .sort((a, b) => b.games - a.games);

  // 파트너 랭킹 — 내 게임의 다른 참가자별 함께친 횟수.
  const gameIds = myGames.map((g) => g.gameId);
  const partnerMap = new Map<string, { name: string; games: number }>();
  if (gameIds.length > 0) {
    const co = await prisma.gamePlayer.findMany({
      where: { gameId: { in: gameIds }, userId: { not: userId } },
      select: { userId: true, user: { select: { name: true } } },
    });
    for (const c of co) {
      const cur = partnerMap.get(c.userId) ?? { name: c.user.name, games: 0 };
      cur.games++;
      partnerMap.set(c.userId, cur);
    }
  }
  const partners: LabPartnerItem[] = Array.from(partnerMap.entries())
    .map(([pid, v]) => ({ userId: pid, name: v.name, games: v.games }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 10);

  const streakDays = await computeStreak(userId);
  const distinctPartners = partnerMap.size;

  const badges: LabBadge[] = [
    { key: 'first', emoji: '🎉', label: '첫 게임', hint: '첫 게임을 쳤어요', earned: totalGames >= 1 },
    { key: 'games50', emoji: '🏸', label: '50게임', hint: '누적 50게임', earned: totalGames >= 50 },
    { key: 'games100', emoji: '💯', label: '100게임', hint: '누적 100게임', earned: totalGames >= 100 },
    { key: 'streak', emoji: '🔥', label: '연속 출석', hint: '연속 3일 이상 출석', earned: streakDays >= 3 },
    { key: 'social', emoji: '🤝', label: '마당발', hint: '20명과 함께 쳐봄', earned: distinctPartners >= 20 },
    { key: 'active', emoji: '⚡', label: '이달의 열정', hint: '이번 달 10게임', earned: thisMonthGames >= 10 },
  ];

  return {
    userId: user.id,
    name: user.name,
    skillLevel: (user.profile?.skillLevel as string | null) ?? null,
    totalGames,
    thisMonthGames,
    streakDays,
    clubGames,
    partners,
    badges,
  };
}

/** 모임 정산 상세 — 멤버별 회비 + 미납 게스트비 → 청구/납부/잔액. period="YYYY-MM". */
export async function getClubSettlement(
  clubId: string,
  period: string,
): Promise<LabSettlementResponse> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, monthlyDuesAmount: true, duesPeriodType: true, perSessionFee: true, duesAccountInfo: true },
  });
  if (!club) throw new Error('Club not found');

  // 기간 범위 (YYYY-MM, 서버 로컬 = KST).
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1, 0, 0, 0, 0);
  const end = new Date(y, mo + 1, 1, 0, 0, 0, 0);

  // 정기 회비: 이번 달(mo+1)이 주기의 청구월이면 duesAmount, 아니면 0.
  const month1 = mo + 1; // 1~12
  const periodType = club.duesPeriodType || 'NONE';
  const billingMonth =
    periodType === 'MONTHLY' ? true :
    periodType === 'QUARTERLY' ? month1 % 3 === 1 : // 1·4·7·10월
    periodType === 'HALF' ? month1 === 1 || month1 === 7 :
    periodType === 'YEARLY' ? month1 === 1 :
    false;
  const dues = billingMonth ? (club.monthlyDuesAmount ?? 0) : 0;
  const perSessionFee = club.perSessionFee ?? 0;

  // 이번 기간 이 클럽 정모 참석 체크인(참가비 + 대관비 엔빵 계산의 공통 소스).
  const attendCheckins = await prisma.checkIn.findMany({
    where: { checkedInAt: { gte: start, lt: end }, clubSession: { clubId } },
    select: { userId: true, clubSessionId: true },
  });
  const sessMap = new Map<string, Set<string>>(); // userId -> 참석 정모 id들
  const sessionAttendees = new Map<string, Set<string>>(); // 정모 id -> 참석자들
  for (const c of attendCheckins) {
    if (!c.clubSessionId) continue;
    const s = sessMap.get(c.userId) ?? new Set<string>();
    s.add(c.clubSessionId);
    sessMap.set(c.userId, s);
    const a = sessionAttendees.get(c.clubSessionId) ?? new Set<string>();
    a.add(c.userId);
    sessionAttendees.set(c.clubSessionId, a);
  }
  const sessionsOf = (uid: string) => sessMap.get(uid)?.size ?? 0;

  // 대관비 엔빵: rentalCost 가 설정된 정모는 참석자 수로 1/N (올림, 10원 단위).
  const rentalSessions = await prisma.clubSession.findMany({
    where: { clubId, startedAt: { gte: start, lt: end }, rentalCost: { gt: 0 } },
    select: { id: true, rentalCost: true },
  });
  const shareOf = new Map<string, number>(); // 정모 id -> 1인당 엔빵 금액
  for (const s of rentalSessions) {
    const n = sessionAttendees.get(s.id)?.size ?? 0;
    if (n > 0 && s.rentalCost) shareOf.set(s.id, Math.ceil(s.rentalCost / n / 10) * 10);
  }
  const splitOf = (uid: string) => {
    let sum = 0;
    for (const sid of sessMap.get(uid) ?? []) sum += shareOf.get(sid) ?? 0;
    return sum;
  };

  // 클럽 멤버.
  const members = await prisma.clubMember.findMany({
    where: { clubId },
    select: { userId: true, user: { select: { name: true, isGuest: true } } },
  });

  // 이번 기간 회비 납부자.
  const payments = await prisma.duesPayment.findMany({
    where: { clubId, period },
    select: { userId: true },
  });
  const paidSet = new Set(payments.map((p) => p.userId));

  // 이번 기간 이 클럽 세션에서 발생한 미납 게스트비(사용자별 합).
  const guestCheckins = await prisma.checkIn.findMany({
    where: {
      feePaid: false,
      feeAmount: { gt: 0 },
      checkedInAt: { gte: start, lt: end },
      clubSession: { clubId },
    },
    select: { userId: true, feeAmount: true, user: { select: { name: true, isGuest: true } } },
  });
  const guestFeeMap = new Map<string, { name: string; isGuest: boolean; amount: number }>();
  for (const c of guestCheckins) {
    const cur = guestFeeMap.get(c.userId) ?? {
      name: c.user.name,
      isGuest: c.user.isGuest,
      amount: 0,
    };
    cur.amount += c.feeAmount ?? 0;
    guestFeeMap.set(c.userId, cur);
  }

  // 멤버 + (멤버 아닌 게스트 미납자) 합쳐 청구 목록 구성.
  const rows = new Map<string, LabSettlementMember>();
  for (const mem of members) {
    const guest = guestFeeMap.get(mem.userId);
    const guestFees = guest?.amount ?? 0;
    const sessions = sessionsOf(mem.userId);
    const sessionFees = sessions * perSessionFee;
    const splitFees = splitOf(mem.userId);
    // 반자동: 총무가 '입금확인 원클릭' 하면 이 기간 DuesPayment 가 생겨 duesPaid=true →
    // 그 멤버는 완납 처리(잔액 0). 회비+참가비+엔빵+게스트비를 한 번에 정산으로 본다.
    const duesPaid = paidSet.has(mem.userId);
    const total = dues + sessionFees + splitFees + guestFees;
    rows.set(mem.userId, {
      userId: mem.userId,
      name: mem.user.name,
      isGuest: mem.user.isGuest,
      dues,
      sessions,
      sessionFees,
      splitFees,
      guestFees,
      total,
      duesPaid,
      balance: duesPaid ? 0 : total,
    });
  }
  // 멤버가 아닌데 게스트비 미납인 사람도 포함(청구 대상).
  for (const [uid, g] of guestFeeMap.entries()) {
    if (rows.has(uid)) continue;
    const duesPaid = paidSet.has(uid);
    rows.set(uid, {
      userId: uid,
      name: g.name,
      isGuest: g.isGuest,
      dues: 0,
      sessions: 0,
      sessionFees: 0,
      splitFees: 0,
      guestFees: g.amount,
      total: g.amount,
      duesPaid,
      balance: duesPaid ? 0 : g.amount,
    });
  }

  const memberRows = Array.from(rows.values()).sort(
    (a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ko'),
  );

  const billed = memberRows.reduce((s, r) => s + r.total, 0);
  const unpaid = memberRows.reduce((s, r) => s + r.balance, 0);
  const unpaidCount = memberRows.filter((r) => r.balance > 0).length;

  return {
    clubId: club.id,
    clubName: club.name,
    period,
    monthlyDuesAmount: club.monthlyDuesAmount,
    duesAccountInfo: club.duesAccountInfo,
    members: memberRows,
    totals: { billed, paid: billed - unpaid, unpaid, unpaidCount },
  };
}

/** 입금확인 원클릭 — 해당 멤버의 이 기간 정산을 완납 처리(DuesPayment upsert). */
export async function markDuesPaid(
  clubId: string,
  userId: string,
  period: string,
  amount: number,
  recordedById: string,
): Promise<void> {
  const existing = await prisma.duesPayment.findFirst({ where: { clubId, userId, period } });
  if (existing) {
    await prisma.duesPayment.update({ where: { id: existing.id }, data: { amount, paidAt: new Date(), recordedById } });
  } else {
    await prisma.duesPayment.create({ data: { clubId, userId, period, amount, recordedById } });
  }
}

/** 입금확인 취소 — 이 기간 납부 기록 삭제(미납으로 되돌림). */
export async function unmarkDuesPaid(clubId: string, userId: string, period: string): Promise<void> {
  await prisma.duesPayment.deleteMany({ where: { clubId, userId, period } });
}

/** 모임 입금 안내 계좌 설정(청구 메시지에 포함). */
export async function setDuesAccount(clubId: string, info: string | null): Promise<void> {
  await prisma.club.update({ where: { id: clubId }, data: { duesAccountInfo: info } });
}

// ─── 게스트 목록·납부 ──────────────────────────────────────────
export interface LabGuestRow {
  checkInId: string;
  userId: string;
  name: string;
  date: string; // checkedInAt ISO
  sessionTitle: string | null;
  feeAmount: number | null;
  feePaid: boolean;
}

/** 이 기간 이 클럽 정모에 온 게스트 목록(게스트비 납부 상태 포함). */
export async function getClubGuests(clubId: string, period: string): Promise<LabGuestRow[]> {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  const end = new Date(y, mo + 1, 1);

  const rows = await prisma.checkIn.findMany({
    where: {
      checkedInAt: { gte: start, lt: end },
      clubSession: { clubId },
      user: { isGuest: true },
    },
    select: {
      id: true,
      userId: true,
      checkedInAt: true,
      feeAmount: true,
      feePaid: true,
      user: { select: { name: true } },
      clubSession: { select: { title: true } },
    },
    orderBy: { checkedInAt: 'desc' },
  });
  return rows.map((r) => ({
    checkInId: r.id,
    userId: r.userId,
    name: r.user.name,
    date: r.checkedInAt.toISOString(),
    sessionTitle: r.clubSession?.title ?? null,
    feeAmount: r.feeAmount,
    feePaid: r.feePaid,
  }));
}

/** 게스트비 납부 토글(입금확인 원클릭). */
export async function setGuestFeePaid(checkInId: string, paid: boolean): Promise<void> {
  await prisma.checkIn.update({ where: { id: checkInId }, data: { feePaid: paid } });
}

// ─── 게스트 사전 신청 관리 ─────────────────────────────────────
export interface LabGuestApplicationRow {
  id: string;
  name: string;
  isAppUser: boolean; // 앱 회원이 로그인 상태로 신청(userId 연결됨)
  isCheckedIn: boolean; // 당일 체크인과 매칭됨(실제 출석)
  skillLevel: string | null;
  gender: string | null;
  visitDate: string | null;
  phone: string | null;
  note: string | null;
  status: string; // PENDING | CONFIRMED | CANCELLED
  feeAmount: number | null;
  feePaid: boolean;
  createdAt: string;
}

export async function getGuestApplications(clubId: string): Promise<LabGuestApplicationRow[]> {
  const rows = await prisma.guestApplication.findMany({
    where: { clubId },
    // 가까운 방문일 우선(없으면 뒤), 취소는 맨 뒤.
    orderBy: [{ visitDate: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  rows.sort((a, b) => Number(a.status === 'CANCELLED') - Number(b.status === 'CANCELLED'));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isAppUser: !!r.userId,
    isCheckedIn: !!r.checkedInAt,
    skillLevel: r.skillLevel,
    gender: r.gender,
    visitDate: r.visitDate,
    phone: r.phone,
    note: r.note,
    status: r.status,
    feeAmount: r.feeAmount,
    feePaid: r.feePaid,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 신청 갱신 — 입금확인(feePaid) 시 자동 확정(CONFIRMED), 되돌리면 PENDING. */
export async function updateGuestApplication(
  id: string,
  patch: { feePaid?: boolean; status?: string },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.feePaid !== undefined) {
    data.feePaid = patch.feePaid;
    data.status = patch.feePaid ? 'CONFIRMED' : 'PENDING';
  }
  if (patch.status !== undefined) data.status = patch.status;
  const updated = await prisma.guestApplication.update({
    where: { id },
    data,
    include: { club: { select: { name: true } } },
  });

  // 취소로 자리가 났으면 대기열 승격.
  if (updated.status === 'CANCELLED') {
    await promoteWaitlist(updated.clubId, updated.visitDate).catch(() => {});
  }

  // 앱 회원 신청자(userId 연결)에게 확정 푸시 — 익명 신청은 보낼 곳이 없어 생략.
  if (updated.userId && updated.status === 'CONFIRMED' && patch.feePaid) {
    try {
      const visit = updated.visitDate ? ` ${updated.visitDate.slice(5).replace('-', '/')} 방문` : '';
      await sendPushToUser(updated.userId, {
        title: '게스트 신청 확정 🎉',
        body: `${updated.club.name}${visit}이 확정됐어요. 정모에서 만나요!`,
      });
    } catch {
      /* 알림 실패 무시 */
    }
  }
}

// ─── 신청 ↔ 당일 체크인 자동 매칭 ─────────────────────────────
/**
 * 게스트가 실제로 체크인하면 그 클럽의 '오늘 방문' 신청을 찾아 출석 처리.
 * userId 일치 우선, 없으면 이름 일치. 노쇼 파악용 — 실패해도 체크인엔 영향 없음.
 */
export async function matchApplicationOnCheckIn(
  clubId: string,
  who: { userId?: string | null; name?: string | null },
): Promise<void> {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const base = {
    clubId,
    visitDate: today,
    checkedInAt: null,
    status: { in: ['PENDING', 'CONFIRMED', 'WAITLIST'] },
  };

  let app = who.userId
    ? await prisma.guestApplication.findFirst({ where: { ...base, userId: who.userId }, orderBy: { createdAt: 'asc' } })
    : null;
  if (!app && who.name) {
    app = await prisma.guestApplication.findFirst({ where: { ...base, name: who.name.trim() }, orderBy: { createdAt: 'asc' } });
  }
  if (!app) return;
  await prisma.guestApplication.update({ where: { id: app.id }, data: { checkedInAt: new Date() } });
}

// ─── 대기열 자동 승격 ─────────────────────────────────────────
/**
 * 자리가 났을 때(취소 등) 그 날짜의 가장 오래된 대기(WAITLIST) 신청을
 * PENDING으로 승격하고 앱 회원이면 푸시로 알린다. 정원 미설정이면 no-op.
 */
export async function promoteWaitlist(clubId: string, visitDate: string | null): Promise<void> {
  if (!visitDate) return;
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true, maxGuestsPerDay: true },
  });
  if (!club?.maxGuestsPerDay) return;

  const active = await prisma.guestApplication.count({
    where: { clubId, visitDate, status: { in: ['PENDING', 'CONFIRMED'] } },
  });
  if (active >= club.maxGuestsPerDay) return; // 자리 없음

  const next = await prisma.guestApplication.findFirst({
    where: { clubId, visitDate, status: 'WAITLIST' },
    orderBy: { createdAt: 'asc' },
  });
  if (!next) return;

  await prisma.guestApplication.update({ where: { id: next.id }, data: { status: 'PENDING' } });
  if (next.userId) {
    try {
      await sendPushToUser(next.userId, {
        title: '게스트 자리가 났어요 🙌',
        body: `${club.name} ${visitDate.slice(5).replace('-', '/')} 방문 대기가 신청으로 전환됐어요.`,
      });
    } catch {
      /* 알림 실패 무시 */
    }
  }
}

// ─── 운영 정보(운동 일정) + 게스트 신청 정책 ───────────────────
export interface WeeklySlot { day: number; start: string; end: string } // day 0(일)~6(토)
export interface LabOperationConfig {
  clubId: string;
  clubName: string;
  weeklySchedule: WeeklySlot[];
  guestApplyEnabled: boolean;
  guestApplyDeadlineHours: number | null;
  maxGuestsPerDay: number | null;
  contactInfo: string | null; // 운영진 문의 채널(오픈채팅 링크·전화)
  // 정모 자동 개설 — weeklySchedule 슬롯 시작 N분 전에 자동 오픈(홈 시설 필요).
  autoSessionEnabled: boolean;
  autoSessionOpenMinutes: number;
  autoSessionCourtCount: number;
  homeFacilityId: string | null;
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** weeklySchedule 입력 검증 — day 0~6, HH:mm, 최대 7슬롯. 잘못된 항목은 버린다. */
export function sanitizeWeeklySchedule(input: unknown): WeeklySlot[] {
  if (!Array.isArray(input)) return [];
  const out: WeeklySlot[] = [];
  for (const raw of input.slice(0, 7)) {
    const day = Number((raw as { day?: unknown })?.day);
    const start = String((raw as { start?: unknown })?.start ?? '');
    const end = String((raw as { end?: unknown })?.end ?? '');
    if (Number.isInteger(day) && day >= 0 && day <= 6 && HHMM.test(start) && HHMM.test(end)) {
      out.push({ day, start, end });
    }
  }
  out.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return out;
}

export async function getOperationConfig(clubId: string): Promise<LabOperationConfig> {
  const c = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true, name: true, weeklySchedule: true, guestApplyEnabled: true,
      guestApplyDeadlineHours: true, maxGuestsPerDay: true, contactInfo: true,
      autoSessionEnabled: true, autoSessionOpenMinutes: true, autoSessionCourtCount: true,
      homeFacilityId: true,
    },
  });
  if (!c) throw new Error('Club not found');
  return {
    clubId: c.id,
    clubName: c.name,
    weeklySchedule: sanitizeWeeklySchedule(c.weeklySchedule),
    guestApplyEnabled: c.guestApplyEnabled,
    guestApplyDeadlineHours: c.guestApplyDeadlineHours,
    maxGuestsPerDay: c.maxGuestsPerDay,
    contactInfo: c.contactInfo,
    autoSessionEnabled: c.autoSessionEnabled,
    autoSessionOpenMinutes: c.autoSessionOpenMinutes,
    autoSessionCourtCount: c.autoSessionCourtCount,
    homeFacilityId: c.homeFacilityId,
  };
}

export async function setOperationConfig(
  clubId: string,
  cfg: Partial<{
    weeklySchedule: unknown; guestApplyEnabled: boolean; guestApplyDeadlineHours: number | null;
    maxGuestsPerDay: number | null; contactInfo: string | null;
    autoSessionEnabled: boolean; autoSessionOpenMinutes: number; autoSessionCourtCount: number;
  }>,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (cfg.weeklySchedule !== undefined) data.weeklySchedule = sanitizeWeeklySchedule(cfg.weeklySchedule);
  if (cfg.autoSessionEnabled !== undefined) data.autoSessionEnabled = !!cfg.autoSessionEnabled;
  if (cfg.autoSessionOpenMinutes !== undefined) {
    const n = Number(cfg.autoSessionOpenMinutes);
    // 0(정각)~240분 전 오픈만 허용, 이상값은 기본 60.
    data.autoSessionOpenMinutes = Number.isInteger(n) && n >= 0 && n <= 240 ? n : 60;
  }
  if (cfg.autoSessionCourtCount !== undefined) {
    const n = Number(cfg.autoSessionCourtCount);
    data.autoSessionCourtCount = Number.isInteger(n) && n >= 1 && n <= 20 ? n : 4;
  }
  if (cfg.guestApplyEnabled !== undefined) data.guestApplyEnabled = !!cfg.guestApplyEnabled;
  if (cfg.guestApplyDeadlineHours !== undefined) {
    // 범위 밖 값을 조용히 null(마감 없음)로 바꾸면 운영자 의도와 반대가 되므로 168h(7일)로 클램프.
    const n = Number(cfg.guestApplyDeadlineHours);
    data.guestApplyDeadlineHours = Number.isInteger(n) && n >= 0 ? Math.min(n, 168) : null;
  }
  if (cfg.maxGuestsPerDay !== undefined) {
    const n = Number(cfg.maxGuestsPerDay);
    data.maxGuestsPerDay = Number.isInteger(n) && n > 0 && n <= 100 ? n : null;
  }
  if (cfg.contactInfo !== undefined) {
    data.contactInfo = cfg.contactInfo != null ? String(cfg.contactInfo).trim().slice(0, 200) || null : null;
  }
  await prisma.club.update({ where: { id: clubId }, data });
}

// ─── 회비·게스트비 설정 ────────────────────────────────────────
export interface LabDuesConfig {
  clubId: string;
  clubName: string;
  duesPeriodType: string; // NONE|MONTHLY|QUARTERLY|HALF|YEARLY
  duesAmount: number | null; // 주기당 회비(=monthlyDuesAmount)
  perSessionFee: number | null; // 정모별 참가비(번개)
  guestFee: number | null; // 게스트 기본비
  duesAccountInfo: string | null;
}

export async function getDuesConfig(clubId: string): Promise<LabDuesConfig> {
  const c = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, monthlyDuesAmount: true, duesPeriodType: true, perSessionFee: true, guestFee: true, duesAccountInfo: true },
  });
  if (!c) throw new Error('Club not found');
  return {
    clubId: c.id,
    clubName: c.name,
    duesPeriodType: c.duesPeriodType,
    duesAmount: c.monthlyDuesAmount,
    perSessionFee: c.perSessionFee,
    guestFee: c.guestFee,
    duesAccountInfo: c.duesAccountInfo,
  };
}

// ─── 정모별 대관비(엔빵) ────────────────────────────────────────
export interface LabSessionRow {
  id: string;
  title: string | null;
  date: string; // startedAt ISO
  attendees: number;
  rentalCost: number | null;
  perHead: number | null; // 1인당 엔빵(참석자 있을 때)
}

/** 이 기간 이 클럽의 정모 목록(참석 인원·대관비·1인당 엔빵). */
export async function getClubSessions(clubId: string, period: string): Promise<LabSessionRow[]> {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  const end = new Date(y, mo + 1, 1);

  const sessions = await prisma.clubSession.findMany({
    where: { clubId, startedAt: { gte: start, lt: end } },
    select: {
      id: true,
      title: true,
      startedAt: true,
      rentalCost: true,
      // 정산의 엔빵과 동일 기준: 중복 체크인 제거한 '고유 참석 인원'.
      checkIns: { select: { userId: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  return sessions.map((s) => {
    const n = new Set(s.checkIns.map((c) => c.userId)).size;
    return {
      id: s.id,
      title: s.title,
      date: s.startedAt?.toISOString() ?? '',
      attendees: n,
      rentalCost: s.rentalCost,
      perHead: s.rentalCost && n > 0 ? Math.ceil(s.rentalCost / n / 10) * 10 : null,
    };
  });
}

/** 정모 대관비 설정(엔빵 총액). null=미사용. */
export async function setSessionRentalCost(sessionId: string, cost: number | null): Promise<void> {
  await prisma.clubSession.update({ where: { id: sessionId }, data: { rentalCost: cost } });
}

export async function setDuesConfig(
  clubId: string,
  cfg: Partial<{ duesPeriodType: string; duesAmount: number | null; perSessionFee: number | null; guestFee: number | null; duesAccountInfo: string | null }>,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (cfg.duesPeriodType !== undefined) data.duesPeriodType = cfg.duesPeriodType;
  if (cfg.duesAmount !== undefined) data.monthlyDuesAmount = cfg.duesAmount;
  if (cfg.perSessionFee !== undefined) data.perSessionFee = cfg.perSessionFee;
  if (cfg.guestFee !== undefined) data.guestFee = cfg.guestFee;
  if (cfg.duesAccountInfo !== undefined) data.duesAccountInfo = cfg.duesAccountInfo;
  await prisma.club.update({ where: { id: clubId }, data });
}

// ─── 레슨 중개 MVP ────────────────────────────────────────────
// 모임 내 레슨 운영: 운영진이 레슨 상품(코치·요일·시간·레슨비·정원)을 열고
// 앱 회원이 신청 → 운영진 확정. 정산 합산·수수료는 후속.

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export interface LabLessonOffer {
  id: string;
  coachName: string;
  coachIntro: string | null;
  coachCareer: string | null;
  // 등록 코치 프로필 연결(숨고식) — 연결 시 사진·인증 뱃지 노출, 코치 본인이 로스터 접근.
  coachProfileId: string | null;
  coachPhotoUrl: string | null;
  coachCertified: boolean;
  days: number[]; // [1,3,5] = 월수금
  start: string;
  end: string;
  fee: number | null; // 월 레슨비
  capacity: number | null;
  enabled: boolean;
  summary: string; // "월·수·금 19:00~20:00"
  applicants: number; // PENDING+CONFIRMED (정원 게이지 — 대기는 미포함)
  waitlistCount: number; // 대기 인원
  myStatus: string | null; // 조회자 본인의 신청 상태(PENDING/CONFIRMED/WAITLIST) — 회원 조회에서만
  myWaitRank: number | null; // WAITLIST 면 내 대기 순위(1부터)
  myFeePaid: boolean; // 본인 레슨비 입금확인 여부(회원 조회에서만)
}

export interface LabLessonApplicationRow {
  id: string;
  offerId: string;
  offerSummary: string;
  coachName: string;
  name: string;
  isAppUser: boolean;
  phone: string | null;
  note: string | null;
  status: string; // PENDING | CONFIRMED | CANCELLED
  feePaid: boolean; // 레슨비 입금확인
  createdAt: string;
}

/** days Json → 정제된 요일 배열(0~6, 중복 제거, 정렬). 비면 [day] 폴백. */
function lessonDays(o: { day: number; days?: unknown }): number[] {
  const raw = Array.isArray(o.days) ? o.days : [];
  const out = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return out.length > 0 ? out : [o.day];
}

function lessonSummary(o: { day: number; days?: unknown; start: string; end: string }): string {
  const ds = lessonDays(o).map((d) => DAY_KO[d]).join('·');
  return `${ds} ${o.start}~${o.end}`;
}

/** 레슨 상품 목록(신청자 수 포함). enabledOnly면 회원 노출용으로 활성만.
 *  forUserId를 주면 그 사용자의 신청 상태(myStatus)를 함께 내려준다. */
export async function getLessonOffers(clubId: string, enabledOnly = false, forUserId?: string): Promise<LabLessonOffer[]> {
  const offers = await prisma.lessonOffer.findMany({
    where: { clubId, ...(enabledOnly ? { enabled: true } : {}) },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
    include: {
      coachProfile: { select: { id: true, photoUrl: true, certified: true } },
      _count: { select: { applications: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } } } },
      // 대기열 전체(순번 계산용) + 내 신청 — 한 쿼리에서 뽑는다.
      applications: {
        where: forUserId
          ? { OR: [{ status: 'WAITLIST' }, { userId: forUserId, status: { in: ['PENDING', 'CONFIRMED'] } }] }
          : { status: 'WAITLIST' },
        select: { userId: true, status: true, feePaid: true, waitOrder: true },
        orderBy: { waitOrder: 'asc' },
      },
    },
  });
  return offers.map((o) => {
    const rows = (o as unknown as { applications: { userId: string | null; status: string; feePaid: boolean; waitOrder: number | null }[] }).applications;
    const waitRows = rows.filter((r) => r.status === 'WAITLIST');
    const mine = forUserId ? rows.find((r) => r.userId === forUserId) ?? null : null;
    const myWaitRank = mine?.status === 'WAITLIST' ? waitRows.findIndex((r) => r.userId === forUserId) + 1 : null;
    return ({
    id: o.id,
    coachName: o.coachName,
    coachIntro: o.coachIntro,
    coachCareer: o.coachCareer,
    coachProfileId: o.coachProfile?.id ?? null,
    coachPhotoUrl: o.coachProfile?.photoUrl ?? null,
    coachCertified: o.coachProfile?.certified ?? false,
    days: lessonDays(o),
    start: o.start,
    end: o.end,
    fee: o.fee,
    capacity: o.capacity,
    enabled: o.enabled,
    summary: lessonSummary(o),
    applicants: o._count.applications,
    waitlistCount: waitRows.length,
    myStatus: mine?.status ?? null,
    myWaitRank,
    myFeePaid: mine?.feePaid ?? false,
    });
  });
}

/** 레슨 상품 생성/수정. id 있으면 수정(소유권은 라우터에서 확인). */
export async function upsertLessonOffer(
  clubId: string,
  input: {
    id?: string; coachName?: string; coachIntro?: string | null; coachCareer?: string | null;
    coachProfileId?: string | null;
    days?: number[]; day?: number; start?: string; end?: string;
    fee?: number | null; capacity?: number | null; enabled?: boolean;
  },
): Promise<string> {
  let coachName = String(input.coachName ?? '').trim();

  // 등록 코치 연결(숨고식): 프로필 존재·활성 확인. 이름이 비어 있으면 프로필
  // 이름으로 자동 채움(하위호환 텍스트 필드는 유지).
  let linkedProfile: { id: string; displayName: string; intro: string | null; career: string | null } | null = null;
  if (input.coachProfileId) {
    const p = await prisma.coachProfile.findUnique({
      where: { id: String(input.coachProfileId) },
      select: { id: true, displayName: true, intro: true, career: true, active: true },
    });
    if (!p || !p.active) throw new BadRequestError('연결할 코치 프로필을 찾을 수 없어요.');
    linkedProfile = p;
    if (!coachName) coachName = p.displayName;
  }
  const start = String(input.start ?? '');
  const end = String(input.end ?? '');
  // days 배열 우선, 없으면 단일 day 호환.
  const rawDays = Array.isArray(input.days) ? input.days : input.day !== undefined ? [input.day] : [];
  const days = [...new Set(rawDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const intro = input.coachIntro != null ? String(input.coachIntro).trim().slice(0, 60) || null : input.coachIntro;
  const career = input.coachCareer != null ? String(input.coachCareer).trim().slice(0, 500) || null : input.coachCareer;

  if (input.id) {
    const data: Record<string, unknown> = {};
    if (input.coachName !== undefined) data.coachName = coachName;
    if (input.coachIntro !== undefined) data.coachIntro = intro;
    if (input.coachCareer !== undefined) data.coachCareer = career;
    if (input.coachProfileId !== undefined) {
      data.coachProfileId = linkedProfile?.id ?? null;
      if (linkedProfile) {
        // 연결 시 텍스트 필드를 프로필 값으로 동기화(입력 안 했을 때만).
        if (input.coachName === undefined) data.coachName = linkedProfile.displayName;
        if (input.coachIntro === undefined && linkedProfile.intro) data.coachIntro = linkedProfile.intro.slice(0, 60);
        if (input.coachCareer === undefined && linkedProfile.career) data.coachCareer = linkedProfile.career.slice(0, 500);
      }
    }
    if ((input.days !== undefined || input.day !== undefined) && days.length > 0) {
      data.days = days;
      data.day = days[0];
    }
    if (input.start !== undefined && HHMM.test(start)) data.start = start;
    if (input.end !== undefined && HHMM.test(end)) data.end = end;
    if (input.fee !== undefined) data.fee = input.fee != null && Number(input.fee) > 0 ? Number(input.fee) : null;
    if (input.capacity !== undefined) data.capacity = input.capacity != null && Number(input.capacity) > 0 ? Number(input.capacity) : null;
    if (input.enabled !== undefined) data.enabled = !!input.enabled;
    await prisma.lessonOffer.update({ where: { id: input.id }, data });
    return input.id;
  }
  if (!coachName) throw new BadRequestError('코치명을 입력해 주세요.');
  if (days.length === 0) throw new BadRequestError('레슨 요일을 선택해 주세요.');
  // 번개 모임(MEETUP)은 레슨 기능 없음 — 정기 클럽으로 전환 후 개설.
  const clubType = await prisma.club.findUnique({ where: { id: clubId }, select: { clubType: true } });
  if (clubType?.clubType === 'MEETUP') throw new BadRequestError('번개 모임에서는 레슨을 열 수 없어요. 모임 관리에서 정기 클럽으로 전환해 주세요.');
  if (!HHMM.test(start) || !HHMM.test(end)) throw new BadRequestError('시간 형식은 HH:mm 이에요.');
  const created = await prisma.lessonOffer.create({
    data: {
      clubId,
      coachName,
      coachIntro: intro ?? (linkedProfile?.intro?.slice(0, 60) || null),
      coachCareer: career ?? (linkedProfile?.career?.slice(0, 500) || null),
      coachProfileId: linkedProfile?.id ?? null,
      day: days[0],
      days,
      start,
      end,
      fee: input.fee != null && Number(input.fee) > 0 ? Number(input.fee) : null,
      capacity: input.capacity != null && Number(input.capacity) > 0 ? Number(input.capacity) : null,
      enabled: input.enabled !== false,
    },
  });
  return created.id;
}

export async function deleteLessonOffer(offerId: string): Promise<void> {
  await prisma.lessonOffer.delete({ where: { id: offerId } });
}

/** 클럽의 레슨 신청 목록(운영자용) — CANCELLED는 뒤로. */
export async function getLessonApplications(clubId: string): Promise<LabLessonApplicationRow[]> {
  const rows = await prisma.lessonApplication.findMany({
    where: { offer: { clubId } },
    orderBy: { createdAt: 'desc' },
    include: { offer: { select: { coachName: true, day: true, days: true, start: true, end: true } } },
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    offerId: r.offerId,
    offerSummary: lessonSummary(r.offer),
    coachName: r.offer.coachName,
    name: r.name,
    isAppUser: !!r.userId,
    phone: r.phone,
    note: r.note,
    status: r.status,
    feePaid: r.feePaid,
    createdAt: r.createdAt.toISOString(),
  }));
  return [...mapped.filter((r) => r.status !== 'CANCELLED'), ...mapped.filter((r) => r.status === 'CANCELLED')];
}

/** 회원 레슨 신청 — 정원 초과·중복 방지, 운영진 푸시. */
export async function applyLesson(
  offerId: string,
  applicant: { userId: string; name: string; phone?: string | null; note?: string | null },
): Promise<{ id: string; message: string }> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    include: { club: { select: { id: true, name: true } } },
  });
  if (!offer || !offer.enabled) throw new BadRequestError('신청할 수 없는 레슨이에요.');

  const dup = await prisma.lessonApplication.findFirst({
    where: { offerId, userId: applicant.userId, status: { in: ['PENDING', 'CONFIRMED', 'WAITLIST'] } },
  });
  if (dup) throw new BadRequestError(dup.status === 'WAITLIST' ? '이미 대기 중인 레슨이에요.' : '이미 신청한 레슨이에요.');

  // 정원이 가득 차면 거절 대신 대기열(WAITLIST) 등록 — 레슨반장 수기 대기 관리를 대체.
  let toWaitlist = false;
  if (offer.capacity) {
    const active = await prisma.lessonApplication.count({
      where: { offerId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    toWaitlist = active >= offer.capacity;
  }

  let waitOrder: number | null = null;
  if (toWaitlist) {
    const last = await prisma.lessonApplication.aggregate({
      where: { offerId, status: 'WAITLIST' },
      _max: { waitOrder: true },
    });
    waitOrder = (last._max.waitOrder ?? 0) + 1;
  }

  const app = await prisma.lessonApplication.create({
    data: {
      offerId,
      userId: applicant.userId,
      name: applicant.name.trim().slice(0, 30),
      phone: applicant.phone ? String(applicant.phone).slice(0, 20) : null,
      note: applicant.note ? String(applicant.note).slice(0, 200) : null,
      ...(toWaitlist ? { status: 'WAITLIST', waitOrder } : {}),
    },
  });

  const waitRank = toWaitlist
    ? await prisma.lessonApplication.count({ where: { offerId, status: 'WAITLIST', waitOrder: { lte: waitOrder! } } })
    : null;

  // 운영진에게 신청 접수 푸시(실패해도 신청은 성공).
  try {
    const staff = await prisma.clubMember.findMany({
      where: { clubId: offer.club.id, role: { in: ['LEADER', 'STAFF'] } },
      select: { userId: true },
    });
    const { sendPushToUsers } = await import('../notification/notification.service');
    await sendPushToUsers(staff.map((s) => s.userId), {
      title: toWaitlist ? '레슨 대기 등록' : '레슨 신청',
      body: toWaitlist
        ? `${app.name}님이 ${offer.coachName} 코치 레슨 대기 ${waitRank}번으로 등록했어요`
        : `${app.name}님이 ${offer.coachName} 코치 레슨(${lessonSummary(offer)})을 신청했어요`,
    });
  } catch {
    /* 알림 실패 무시 */
  }

  return {
    id: app.id,
    message: toWaitlist
      ? `정원이 가득 차 대기 ${waitRank}번으로 등록됐어요. 자리가 나면 알림을 보내드려요.`
      : `${offer.coachName} 코치 레슨 신청이 접수됐어요. 운영진 확정 후 알림을 보내드려요.`,
  };
}

/** 자리 발생 시 대기 1순위에게 알림(자동 승급은 안 함 — 운영자·코치가 '대기 풀기'). */
export async function notifyWaitlistSeat(offerId: string): Promise<void> {
  try {
    const first = await prisma.lessonApplication.findFirst({
      where: { offerId, status: 'WAITLIST', userId: { not: null } },
      orderBy: { waitOrder: 'asc' },
      include: { offer: { select: { coachName: true } } },
    });
    if (!first?.userId) return;
    await sendPushToUser(first.userId, {
      title: '레슨 자리가 났어요 🏸',
      body: `${first.offer.coachName} 코치 레슨에 자리가 생겼어요 — 운영진이 곧 대기를 풀어드릴 거예요`,
      data: { type: 'lessonWaitlistSeat', offerId },
    });
  } catch {
    /* 알림 실패 무시 */
  }
}

/** 대기 풀기(승급) — WAITLIST → PENDING(확정 대기). 이후 확정은 기존 운영자 flow. */
export async function promoteFromWaitlist(offerId: string, applicationId: string): Promise<void> {
  const app = await prisma.lessonApplication.findUnique({ where: { id: applicationId } });
  if (!app || app.offerId !== offerId) throw new NotFoundError('대기자');
  if (app.status !== 'WAITLIST') throw new BadRequestError('대기 상태가 아니에요.');
  await prisma.lessonApplication.update({
    where: { id: applicationId },
    data: { status: 'PENDING', waitOrder: null },
  });
  if (app.userId) {
    try {
      await sendPushToUser(app.userId, {
        title: '대기가 풀렸어요 🎉',
        body: '레슨 자리가 나서 신청 대기로 올라갔어요 — 운영진 확정 후 알림을 보내드려요',
        data: { type: 'lessonWaitlistPromoted', offerId },
      });
    } catch {
      /* 알림 실패 무시 */
    }
  }
}

/** 레슨 신청 갱신(운영자) — 상태 변경·레슨비 입금확인. CONFIRMED 전환 시 신청자 푸시. */
export async function updateLessonApplication(
  id: string,
  patch: { status?: string; feePaid?: boolean },
  byUserId?: string,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!['PENDING', 'CONFIRMED', 'CANCELLED'].includes(patch.status)) throw new BadRequestError('잘못된 상태예요.');
    data.status = patch.status;
  }
  const updated = await prisma.lessonApplication.update({
    where: { id },
    data,
    include: { offer: { include: { club: { select: { name: true } } } } },
  });
  // 레거시 feePaid 토글 → 당월 수납 기록(LessonFeeRecord)으로 위임.
  // feePaid 컬럼 자체는 syncFeePaidFlag가 파생값으로 갱신한다(이중 소스 방지).
  if (patch.feePaid !== undefined) {
    if (patch.feePaid) await confirmLessonFee(updated.offerId, id, currentPeriod(), byUserId ?? 'legacy-toggle');
    else await unconfirmLessonFee(updated.offerId, id, currentPeriod());
  }
  const status = patch.status;
  // 확정자가 취소되면 자리가 생긴 것 — 대기 1순위에게 알림.
  if (status === 'CANCELLED') notifyWaitlistSeat(updated.offerId);
  if (updated.userId && status === 'CONFIRMED') {
    try {
      await sendPushToUser(updated.userId, {
        title: '레슨 확정 🏸',
        body: `${updated.offer.club.name} ${updated.offer.coachName} 코치 레슨(${lessonSummary(updated.offer)})이 확정됐어요!`,
      });
    } catch {
      /* 알림 실패 무시 */
    }
  }
}

// ─── 레슨 상세: 수강생 로스터 + 회차 출석 (운영자 또는 담당 코치) ─────────────

export interface LessonStudentRow {
  id: string; // applicationId
  name: string;
  phone: string | null;
  isAppUser: boolean;
  status: string; // PENDING | CONFIRMED | CANCELLED
  feePaid: boolean;
  enrollState: string; // ACTIVE | PAUSED | ENDED
  note: string | null;
  attendCount: number; // 누적 출석 회수
  createdAt: string;
}

export interface LessonWaitRow {
  id: string;
  rank: number; // 대기 순위(1부터)
  name: string;
  phone: string | null;
  isAppUser: boolean;
  createdAt: string;
}

export interface LessonDetailView {
  offer: LabLessonOffer & { clubId: string; clubName: string };
  isCoach: boolean; // 조회자가 이 레슨의 담당 코치 본인인지
  roster: LessonStudentRow[];
  waitlist: LessonWaitRow[]; // 대기열(순번순)
}

/** 이 레슨의 담당 코치 본인인지 — staff 가 아니어도 로스터·출석 접근을 허용하는 가드. */
export async function isOfferCoach(offerId: string, userId: string): Promise<boolean> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    select: { coachProfile: { select: { userId: true } } },
  });
  return offer?.coachProfile?.userId === userId;
}

/** 레슨 상세(코치 헤더 + 로스터). CANCELLED 신청은 로스터에서 제외. */
export async function getLessonDetail(offerId: string, viewerUserId?: string): Promise<LessonDetailView> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    include: {
      club: { select: { id: true, name: true } },
      coachProfile: { select: { id: true, photoUrl: true, certified: true, userId: true } },
      _count: { select: { applications: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } } } },
    },
  });
  if (!offer) throw new NotFoundError('레슨');

  const apps = await prisma.lessonApplication.findMany({
    where: { offerId, status: { notIn: ['CANCELLED', 'WAITLIST'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED 먼저(알파벳순 우연 일치)
    include: { _count: { select: { attendance: { where: { present: true } } } } },
  });
  const waits = await prisma.lessonApplication.findMany({
    where: { offerId, status: 'WAITLIST' },
    orderBy: { waitOrder: 'asc' },
  });

  return {
    offer: {
      id: offer.id,
      clubId: offer.club.id,
      clubName: offer.club.name,
      coachName: offer.coachName,
      coachIntro: offer.coachIntro,
      coachCareer: offer.coachCareer,
      coachProfileId: offer.coachProfile?.id ?? null,
      coachPhotoUrl: offer.coachProfile?.photoUrl ?? null,
      coachCertified: offer.coachProfile?.certified ?? false,
      days: lessonDays(offer),
      start: offer.start,
      end: offer.end,
      fee: offer.fee,
      capacity: offer.capacity,
      enabled: offer.enabled,
      summary: lessonSummary(offer),
      applicants: offer._count.applications,
      waitlistCount: waits.length,
      myStatus: null,
      myWaitRank: null,
      myFeePaid: false,
    },
    isCoach: !!viewerUserId && offer.coachProfile?.userId === viewerUserId,
    roster: apps.map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      isAppUser: !!a.userId,
      status: a.status,
      feePaid: a.feePaid,
      enrollState: a.enrollState,
      note: a.note,
      attendCount: a._count.attendance,
      createdAt: a.createdAt.toISOString(),
    })),
    waitlist: waits.map((w, i) => ({
      id: w.id,
      rank: i + 1,
      name: w.name,
      phone: w.phone,
      isAppUser: !!w.userId,
      createdAt: w.createdAt.toISOString(),
    })),
  };
}

/** 수강생 상태 갱신(수강중/휴식/종료 + 메모). 소유권은 라우터에서 확인. */
export async function updateLessonStudent(
  applicationId: string,
  patch: { enrollState?: string; note?: string | null },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.enrollState !== undefined) {
    if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(patch.enrollState)) throw new BadRequestError('잘못된 수강 상태예요.');
    data.enrollState = patch.enrollState;
  }
  if (patch.note !== undefined) {
    data.note = patch.note ? String(patch.note).trim().slice(0, 200) || null : null;
  }
  if (Object.keys(data).length === 0) return;
  const before = await prisma.lessonApplication.findUnique({ where: { id: applicationId }, select: { enrollState: true, offerId: true } });
  await prisma.lessonApplication.update({ where: { id: applicationId }, data });
  // 수강 종료로 자리가 생기면 대기 1순위에게 알림.
  if (patch.enrollState === 'ENDED' && before?.enrollState !== 'ENDED' && before) {
    notifyWaitlistSeat(before.offerId);
  }
}

const DATE_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 특정 날짜의 출석 현황 — { applicationId → present } 목록. */
export async function getLessonAttendance(offerId: string, date: string): Promise<{ applicationId: string; present: boolean }[]> {
  if (!DATE_YMD.test(date)) throw new BadRequestError('날짜 형식은 YYYY-MM-DD 이에요.');
  const rows = await prisma.lessonAttendance.findMany({ where: { offerId, date }, select: { applicationId: true, present: true } });
  return rows;
}

/** 특정 날짜 출석 일괄 저장(업서트). 이 레슨의 신청만 허용. */
export async function setLessonAttendance(
  offerId: string,
  date: string,
  entries: { applicationId: string; present: boolean }[],
): Promise<void> {
  if (!DATE_YMD.test(date)) throw new BadRequestError('날짜 형식은 YYYY-MM-DD 이에요.');
  if (!Array.isArray(entries) || entries.length === 0) return;
  const valid = await prisma.lessonApplication.findMany({
    where: { offerId, id: { in: entries.map((e) => String(e.applicationId)) } },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const ops = entries
    .filter((e) => validIds.has(String(e.applicationId)))
    .map((e) =>
      prisma.lessonAttendance.upsert({
        where: { applicationId_date: { applicationId: String(e.applicationId), date } },
        create: { offerId, applicationId: String(e.applicationId), date, present: !!e.present },
        update: { present: !!e.present },
      }),
    );
  await prisma.$transaction(ops);
}

// ─── 레슨비 월 수납(수동 입금확인) — LessonFeeRecord ─────────
// 계좌이체 기반 "수강생 입금 신고 → 운영진·반장 원터치 확인" 원장. 미납 = 행 없음.
// LessonPayment(카드결제, PAYMENTS_MOCK 게이트)와 분리돼 게이트 밖에서 항상 동작.
// LessonApplication.feePaid 는 "당월 CONFIRMED 여부"의 파생값으로 동기화한다.

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface LessonFeeRow {
  applicationId: string;
  name: string;
  isAppUser: boolean;
  enrollState: string; // ACTIVE | PAUSED
  status: 'UNPAID' | 'REPORTED' | 'CONFIRMED';
  amount: number | null; // 기록된 금액(미납이면 null)
  reportedAt: string | null;
  confirmedAt: string | null;
}

export interface LessonFeesView {
  offerId: string;
  period: string;
  fee: number | null; // 현재 월 레슨비(안내용)
  rows: LessonFeeRow[];
  confirmedCount: number;
  reportedCount: number;
  unpaidCount: number;
  totalConfirmed: number;
}

/** 수납 대상 로스터 — 확정 수강생(종료 제외). */
async function lessonFeeRoster(offerId: string) {
  return prisma.lessonApplication.findMany({
    where: { offerId, status: 'CONFIRMED', enrollState: { not: 'ENDED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, userId: true, enrollState: true },
  });
}

/** 월별 수납 현황(운영진·담당코치). */
export async function getLessonFees(offerId: string, period: string): Promise<LessonFeesView> {
  if (!PERIOD_RE.test(period)) throw new BadRequestError('기간 형식은 YYYY-MM 이에요.');
  const offer = await prisma.lessonOffer.findUnique({ where: { id: offerId }, select: { fee: true } });
  if (!offer) throw new NotFoundError('레슨');
  const [roster, records] = await Promise.all([
    lessonFeeRoster(offerId),
    prisma.lessonFeeRecord.findMany({ where: { offerId, period } }),
  ]);
  const byApp = new Map(records.map((r) => [r.applicationId, r]));
  const rows: LessonFeeRow[] = roster.map((a) => {
    const rec = byApp.get(a.id);
    return {
      applicationId: a.id,
      name: a.name,
      isAppUser: !!a.userId,
      enrollState: a.enrollState,
      status: rec ? (rec.status as 'REPORTED' | 'CONFIRMED') : 'UNPAID',
      amount: rec?.amount ?? null,
      reportedAt: rec?.reportedAt?.toISOString() ?? null,
      confirmedAt: rec?.confirmedAt?.toISOString() ?? null,
    };
  });
  const confirmed = rows.filter((r) => r.status === 'CONFIRMED');
  return {
    offerId,
    period,
    fee: offer.fee ?? null,
    rows,
    confirmedCount: confirmed.length,
    reportedCount: rows.filter((r) => r.status === 'REPORTED').length,
    unpaidCount: rows.filter((r) => r.status === 'UNPAID').length,
    totalConfirmed: confirmed.reduce((s, r) => s + (r.amount ?? 0), 0),
  };
}

/** 당월이면 레거시 feePaid(단일 boolean)를 파생값으로 동기화. */
async function syncFeePaidFlag(applicationId: string, period: string): Promise<void> {
  if (period !== currentPeriod()) return;
  const rec = await prisma.lessonFeeRecord.findUnique({
    where: { applicationId_period: { applicationId, period } },
    select: { status: true },
  });
  await prisma.lessonApplication.update({
    where: { id: applicationId },
    data: { feePaid: rec?.status === 'CONFIRMED' },
  });
}

/** 입금 확인(확정) — 운영진·담당코치. 신고 없이도 바로 확정 가능. */
export async function confirmLessonFee(
  offerId: string,
  applicationId: string,
  period: string,
  byUserId: string,
): Promise<void> {
  if (!PERIOD_RE.test(period)) throw new BadRequestError('기간 형식은 YYYY-MM 이에요.');
  const app = await prisma.lessonApplication.findUnique({
    where: { id: applicationId },
    include: { offer: { select: { id: true, fee: true } } },
  });
  if (!app || app.offerId !== offerId) throw new NotFoundError('수강생');
  await prisma.lessonFeeRecord.upsert({
    where: { applicationId_period: { applicationId, period } },
    create: {
      offerId,
      applicationId,
      period,
      amount: app.offer.fee ?? 0,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: byUserId,
    },
    update: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: byUserId },
  });
  await syncFeePaidFlag(applicationId, period);
}

/** 확인 해제 — 기록 삭제(미납으로 원복). */
export async function unconfirmLessonFee(offerId: string, applicationId: string, period: string): Promise<void> {
  if (!PERIOD_RE.test(period)) throw new BadRequestError('기간 형식은 YYYY-MM 이에요.');
  await prisma.lessonFeeRecord.deleteMany({ where: { offerId, applicationId, period } });
  await syncFeePaidFlag(applicationId, period);
}

/** 무설치 납부 페이지 링크 발급(재발급 시 두 링크 모두 무효화 후 새로 발급).
 *  url = 반원 공유용(단톡), manageUrl = 반장 전용(확인/해제 가능 — 개인 전달만). */
export async function issueLessonShareLink(
  offerId: string,
  regenerate = false,
): Promise<{ url: string; manageUrl: string }> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    select: { publicToken: true, manageToken: true },
  });
  if (!offer) throw new NotFoundError('레슨');
  let pub = offer.publicToken;
  let mng = offer.manageToken;
  if (!pub || !mng || regenerate) {
    pub = randomUUID();
    mng = randomUUID();
    await prisma.lessonOffer.update({ where: { id: offerId }, data: { publicToken: pub, manageToken: mng } });
  }
  const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:8081';
  return { url: `${webBaseUrl}/lesson-pay?t=${pub}`, manageUrl: `${webBaseUrl}/lesson-pay?t=${mng}` };
}

/** 공개/관리 토큰 공용 리졸버 — 어느 쪽이든 offer를 찾고 관리 모드 여부를 알려준다. */
async function findOfferByAnyToken(token: string) {
  if (!token) throw new NotFoundError('납부 페이지');
  const byPublic = await prisma.lessonOffer.findUnique({
    where: { publicToken: token },
    include: { club: { select: { id: true, name: true, duesAccountInfo: true } } },
  });
  if (byPublic) return { offer: byPublic, isManage: false };
  const byManage = await prisma.lessonOffer.findUnique({
    where: { manageToken: token },
    include: { club: { select: { id: true, name: true, duesAccountInfo: true } } },
  });
  if (byManage) return { offer: byManage, isManage: true };
  throw new NotFoundError('납부 페이지');
}

export interface LessonPayPublicView {
  offerId: string;
  clubName: string;
  coachName: string;
  summary: string; // "월·수 19:00~20:00"
  period: string; // 당월 고정
  fee: number | null;
  accountInfo: string | null; // 입금 안내 계좌(클럽 회비 계좌)
  mode: 'pay' | 'manage'; // manage = 반장 링크(확인/해제 가능)
  rows: { applicationId: string; name: string; status: 'UNPAID' | 'REPORTED' | 'CONFIRMED' }[];
}

/** 무설치 납부 페이지 데이터(공개, 토큰 필요). 당월 고정. */
export async function getLessonPayPublicView(token: string): Promise<LessonPayPublicView> {
  const { offer, isManage } = await findOfferByAnyToken(token);
  if (!offer.enabled) throw new NotFoundError('납부 페이지');
  const period = currentPeriod();
  const view = await getLessonFees(offer.id, period);
  return {
    offerId: offer.id,
    clubName: offer.club.name,
    coachName: offer.coachName,
    summary: lessonSummary(offer),
    period,
    fee: offer.fee ?? null,
    accountInfo: offer.club.duesAccountInfo ?? null,
    mode: isManage ? 'manage' : 'pay',
    rows: view.rows.map((r) => ({ applicationId: r.applicationId, name: r.name, status: r.status })),
  };
}

/** 반장 링크로 입금 확인/해제(무로그인) — 관리 토큰만 허용. */
export async function confirmLessonFeeByToken(token: string, applicationId: string, confirm: boolean): Promise<void> {
  const { offer, isManage } = await findOfferByAnyToken(token);
  if (!offer.enabled || !isManage) throw new NotFoundError('납부 페이지');
  if (confirm) await confirmLessonFee(offer.id, applicationId, currentPeriod(), 'manager-link');
  else await unconfirmLessonFee(offer.id, applicationId, currentPeriod());
}

/** 입금 신고 취소(수강생 실수 복구) — 신고(REPORTED) 상태만 되돌린다. 확정은 불가. */
export async function cancelLessonFeeReport(token: string, applicationId: string): Promise<void> {
  const { offer } = await findOfferByAnyToken(token);
  if (!offer.enabled) throw new NotFoundError('납부 페이지');
  const period = currentPeriod();
  await prisma.lessonFeeRecord.deleteMany({
    where: { offerId: offer.id, applicationId, period, status: 'REPORTED' },
  });
}

/** 수강생 입금 신고(공개, 토큰 필요) — 당월 고정. 이미 확정이면 그대로 둔다. */
export async function reportLessonFee(token: string, applicationId: string): Promise<{ status: string }> {
  const { offer } = await findOfferByAnyToken(token);
  if (!offer.enabled) throw new NotFoundError('납부 페이지');
  const app = await prisma.lessonApplication.findUnique({ where: { id: applicationId } });
  if (!app || app.offerId !== offer.id || app.status !== 'CONFIRMED' || app.enrollState === 'ENDED') {
    throw new NotFoundError('수강생');
  }
  const period = currentPeriod();
  const existing = await prisma.lessonFeeRecord.findUnique({
    where: { applicationId_period: { applicationId, period } },
  });
  if (existing?.status === 'CONFIRMED') return { status: 'CONFIRMED' };
  await prisma.lessonFeeRecord.upsert({
    where: { applicationId_period: { applicationId, period } },
    create: { offerId: offer.id, applicationId, period, amount: offer.fee ?? 0, status: 'REPORTED', reportedAt: new Date() },
    update: { status: 'REPORTED', reportedAt: new Date() },
  });
  // 운영진에게 신고 접수 푸시(실패해도 신고는 성공).
  try {
    const staff = await prisma.clubMember.findMany({
      where: { clubId: offer.club.id, role: { in: ['LEADER', 'STAFF'] } },
      select: { userId: true },
    });
    const { sendPushToUsers } = await import('../notification/notification.service');
    await sendPushToUsers(staff.map((s) => s.userId), {
      title: '레슨비 입금 신고 💸',
      body: `${app.name}님이 ${offer.coachName} 코치 레슨 ${period} 레슨비 입금을 신고했어요 — 확인해 주세요`,
      data: { type: 'lessonFeeReported', offerId: offer.id },
    });
  } catch {
    /* 알림 실패 무시 */
  }
  return { status: 'REPORTED' };
}

/** 운영진 수기 수강생 추가 — 앱 미가입 반원 등록(정원 무시: 현장 사실의 기록). */
export async function addLessonStudent(offerId: string, input: { name?: string; phone?: string }): Promise<{ id: string }> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new BadRequestError('이름을 입력해 주세요.');
  if (name.length > 20) throw new BadRequestError('이름은 20자 이내로 입력해 주세요.');
  const offer = await prisma.lessonOffer.findUnique({ where: { id: offerId }, select: { id: true } });
  if (!offer) throw new NotFoundError('레슨');
  const phone = String(input.phone ?? '').replace(/[^0-9]/g, '') || null;
  const app = await prisma.lessonApplication.create({
    data: { offerId, name, phone, status: 'CONFIRMED', enrollState: 'ACTIVE' },
  });
  return { id: app.id };
}

/** 레슨 공지(휴강·보강·전달사항) — 코치·운영진이 수강생 전체에게.
 *  회원 연결 수강생은 푸시, 나머지는 반환된 문구를 단톡에 공유. */
export async function sendLessonNotice(
  offerId: string,
  message: string,
): Promise<{ shareText: string; notifiedCount: number }> {
  const text = String(message ?? '').trim();
  if (!text) throw new BadRequestError('공지 내용을 입력해 주세요.');
  if (text.length > 300) throw new BadRequestError('공지는 300자 이내로 입력해 주세요.');
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    include: { club: { select: { name: true } } },
  });
  if (!offer) throw new NotFoundError('레슨');

  const roster = await lessonFeeRoster(offerId);
  const userIds = (
    await prisma.lessonApplication.findMany({
      where: { id: { in: roster.map((r) => r.id) }, userId: { not: null } },
      select: { userId: true },
    })
  ).map((a) => a.userId!) ;

  let notifiedCount = 0;
  try {
    const { sendPushToUsers } = await import('../notification/notification.service');
    if (userIds.length > 0) {
      await sendPushToUsers(userIds, {
        title: `레슨 공지 — ${offer.coachName} 코치 🏸`,
        body: text,
        data: { type: 'lessonNotice', offerId },
      });
      notifiedCount = userIds.length;
    }
  } catch {
    /* 알림 실패 무시 */
  }

  const shareText = `[${offer.club.name}] ${offer.coachName} 코치 레슨(${lessonSummary(offer)}) 공지\n${text}`;
  return { shareText, notifiedCount };
}

/** 미납 독촉 — 회원 연결 수강생에게 푸시 + 단톡 공유용 문구 반환. */
export async function remindLessonFees(
  offerId: string,
  period: string,
): Promise<{ message: string; unpaidCount: number; notifiedCount: number }> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    include: { club: { select: { name: true, duesAccountInfo: true } } },
  });
  if (!offer) throw new NotFoundError('레슨');
  const view = await getLessonFees(offerId, period);
  const unpaid = view.rows.filter((r) => r.status === 'UNPAID');
  const fee = offer.fee ?? 0;

  // 회원 연결 수강생에게만 푸시(비회원은 공유 문구로).
  const unpaidApps = await prisma.lessonApplication.findMany({
    where: { id: { in: unpaid.map((r) => r.applicationId) }, userId: { not: null } },
    select: { userId: true },
  });
  let notifiedCount = 0;
  try {
    const { sendPushToUsers } = await import('../notification/notification.service');
    const ids = unpaidApps.map((a) => a.userId!).filter(Boolean);
    if (ids.length > 0) {
      await sendPushToUsers(ids, {
        title: '레슨비 안내 🏸',
        body: `${offer.club.name} ${offer.coachName} 코치 ${period} 레슨비${fee ? ` ${fee.toLocaleString()}원` : ''} 입금 부탁드려요`,
        data: { type: 'lessonFeeReminder', offerId },
      });
      notifiedCount = ids.length;
    }
  } catch {
    /* 알림 실패 무시 */
  }

  const lines = [
    `[${offer.club.name}] ${offer.coachName} 코치 ${period} 레슨비 안내`,
    ...unpaid.map((r) => `· ${r.name}${fee ? `: ${fee.toLocaleString()}원` : ''}`),
    offer.club.duesAccountInfo ? `입금계좌: ${offer.club.duesAccountInfo}` : null,
    '입금 후 납부 페이지에서 "입금했어요"를 눌러주세요 🙏',
  ].filter(Boolean);
  return { message: lines.join('\n'), unpaidCount: unpaid.length, notifiedCount };
}

// ─── 레슨 정산 원장(PG 이전 시뮬레이션) ─────────────────────
// 월 레슨비 × 수강생(CONFIRMED & 미종료) = 총액 → 플랫폼 수수료 공제 → 코치 지급 예정액.
// 수납은 아직 feePaid(입금확인) 수동 토글 기준 — PG(빌링키 정기결제) 연동 시
// 실결제 원장으로 대체하고 이 계산은 검증용으로 남긴다.

export const PLATFORM_FEE_RATE = (() => {
  const raw = Number(process.env.PLATFORM_FEE_RATE);
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.1;
})();

export interface LessonBilling {
  offerId: string;
  clubName: string;
  coachName: string;
  summary: string;
  fee: number | null; // 월 레슨비(null 이면 계산 불가 → gross 0)
  activeStudents: number; // 청구 대상(CONFIRMED & enrollState!=ENDED)
  paidCount: number; // 입금확인 수
  gross: number; // fee × activeStudents
  feeRate: number; // 플랫폼 수수료율
  platformFee: number;
  coachPayout: number;
}

export async function getLessonBilling(offerId: string): Promise<LessonBilling> {
  const offer = await prisma.lessonOffer.findUnique({
    where: { id: offerId },
    include: { club: { select: { name: true } } },
  });
  if (!offer) throw new NotFoundError('레슨');
  const students = await prisma.lessonApplication.findMany({
    where: { offerId, status: 'CONFIRMED', enrollState: { not: 'ENDED' } },
    select: { feePaid: true },
  });
  const fee = offer.fee;
  const gross = (fee ?? 0) * students.length;
  const platformFee = Math.round(gross * PLATFORM_FEE_RATE);
  return {
    offerId,
    clubName: offer.club.name,
    coachName: offer.coachName,
    summary: lessonSummary(offer),
    fee,
    activeStudents: students.length,
    paidCount: students.filter((s) => s.feePaid).length,
    gross,
    feeRate: PLATFORM_FEE_RATE,
    platformFee,
    coachPayout: gross - platformFee,
  };
}

export interface CoachSettlement {
  feeRate: number;
  totalGross: number;
  totalPlatformFee: number;
  totalPayout: number;
  lessons: LessonBilling[];
  bank: { bankName: string | null; bankAccount: string | null; bankHolder: string | null } | null;
}

/** 코치 종합 정산(예상) — 내 프로필이 연결된 모든 레슨의 billing 합산. */
export async function getCoachSettlement(userId: string): Promise<CoachSettlement> {
  const profile = await prisma.coachProfile.findUnique({
    where: { userId },
    select: { id: true, bankName: true, bankAccount: true, bankHolder: true },
  });
  const empty: CoachSettlement = { feeRate: PLATFORM_FEE_RATE, totalGross: 0, totalPlatformFee: 0, totalPayout: 0, lessons: [], bank: null };
  if (!profile) return empty;
  empty.bank = { bankName: profile.bankName, bankAccount: profile.bankAccount, bankHolder: profile.bankHolder };
  const offers = await prisma.lessonOffer.findMany({
    where: { coachProfileId: profile.id, enabled: true },
    select: { id: true },
  });
  const lessons = await Promise.all(offers.map((o) => getLessonBilling(o.id)));
  return lessons.reduce(
    (acc, b) => ({
      ...acc,
      totalGross: acc.totalGross + b.gross,
      totalPlatformFee: acc.totalPlatformFee + b.platformFee,
      totalPayout: acc.totalPayout + b.coachPayout,
    }),
    { ...empty, lessons },
  );
}

// ─── 레슨비 결제(임시 MOCK — PG 이전) ─────────────────────────
// 서버 env PAYMENTS_MOCK=1 일 때만 동작(로컬/스테이징). 프로덕션은 기본 차단이라
// 배포돼도 결제가 열리지 않는다. PG 연동 시 이 함수 내부의 '승인' 부분만
// 실제 PG 승인 호출로 바뀌고 원장(LessonPayment) 구조는 유지된다.

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── 회원용 "내 회비" — 기간별 청구/납부 타임라인 ─────────────
// 상용 필수: 회원이 자기가 몇 월에 냈고 뭐가 밀렸는지 직접 본다.
export interface MyDuesPeriodRow {
  period: string; // YYYY-MM
  label: string; // "2026년 7월"
  dues: number; // 정기 회비(청구월만)
  sessions: number; // 참석 정모 수
  sessionFees: number; // 정모 참가비
  splitFees: number; // 대관비 엔빵
  total: number;
  paid: boolean;
  paidAt: string | null;
  paidAmount: number | null;
}
export interface MyDuesResponse {
  clubId: string;
  clubName: string;
  duesPeriodType: string;
  duesAmount: number | null;
  accountInfo: string | null;
  periods: MyDuesPeriodRow[]; // 최신순
  totals: { paidThisYear: number; unpaidCount: number; unpaidAmount: number };
}

export async function getMyDues(clubId: string, userId: string, monthsBack = 6): Promise<MyDuesResponse> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, monthlyDuesAmount: true, duesPeriodType: true, perSessionFee: true, duesAccountInfo: true },
  });
  if (!club) throw new Error('Club not found');
  const periodType = club.duesPeriodType || 'NONE';
  const perSessionFee = club.perSessionFee ?? 0;
  const now = new Date();

  const rows: MyDuesPeriodRow[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const mo = d.getMonth(); // 0-based
    const period = `${y}-${String(mo + 1).padStart(2, '0')}`;
    const start = new Date(y, mo, 1);
    const end = new Date(y, mo + 1, 1);

    const month1 = mo + 1;
    const billingMonth =
      periodType === 'MONTHLY' ? true :
      periodType === 'QUARTERLY' ? month1 % 3 === 1 :
      periodType === 'HALF' ? month1 === 1 || month1 === 7 :
      periodType === 'YEARLY' ? month1 === 1 :
      false;
    const dues = billingMonth ? (club.monthlyDuesAmount ?? 0) : 0;

    // 내 참석 정모(이 클럽, 이 달)
    const myCheckins = await prisma.checkIn.findMany({
      where: { userId, checkedInAt: { gte: start, lt: end }, clubSession: { clubId } },
      select: { clubSessionId: true },
    });
    const mySessionIds = [...new Set(myCheckins.map((c) => c.clubSessionId).filter(Boolean))] as string[];
    const sessionFees = perSessionFee * mySessionIds.length;

    // 대관비 엔빵: 내가 참석한 정모 중 rentalCost 설정된 것
    let splitFees = 0;
    if (mySessionIds.length > 0) {
      const rentals = await prisma.clubSession.findMany({
        where: { id: { in: mySessionIds }, rentalCost: { gt: 0 } },
        select: { id: true, rentalCost: true },
      });
      for (const r of rentals) {
        const attendees = await prisma.checkIn.groupBy({ by: ['userId'], where: { clubSessionId: r.id } });
        const n = attendees.length;
        if (n > 0 && r.rentalCost) splitFees += Math.ceil(r.rentalCost / n / 10) * 10;
      }
    }

    const payment = await prisma.duesPayment.findUnique({
      where: { clubId_userId_period: { clubId, userId, period } },
    });

    rows.push({
      period,
      label: `${y}년 ${month1}월`,
      dues,
      sessions: mySessionIds.length,
      sessionFees,
      splitFees,
      total: dues + sessionFees + splitFees,
      paid: !!payment,
      paidAt: payment?.paidAt.toISOString() ?? null,
      paidAmount: payment?.amount ?? null,
    });
  }

  const yearStart = `${now.getFullYear()}-01`;
  const yearPayments = await prisma.duesPayment.findMany({
    where: { clubId, userId, period: { gte: yearStart } },
    select: { amount: true },
  });
  const unpaid = rows.filter((r) => r.total > 0 && !r.paid);
  return {
    clubId: club.id,
    clubName: club.name,
    duesPeriodType: periodType,
    duesAmount: club.monthlyDuesAmount,
    accountInfo: club.duesAccountInfo,
    periods: rows,
    totals: {
      paidThisYear: yearPayments.reduce((a, p) => a + p.amount, 0),
      unpaidCount: unpaid.length,
      unpaidAmount: unpaid.reduce((a, r) => a + r.total, 0),
    },
  };
}

// ─── 운영자 월별 정산 추이(통계) ──────────────────────────────
export interface MoneyStatRow { period: string; billed: number; paid: number; unpaid: number }
export async function getMoneyStats(clubId: string, monthsBack = 6): Promise<MoneyStatRow[]> {
  const now = new Date();
  const out: MoneyStatRow[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const s = await getClubSettlement(clubId, period);
    out.push({ period, billed: s.totals.billed, paid: s.totals.paid, unpaid: s.totals.unpaid });
  }
  return out;
}

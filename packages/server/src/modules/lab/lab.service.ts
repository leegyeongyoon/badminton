import { prisma } from '../../utils/prisma';
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
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isAppUser: !!r.userId,
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
  await prisma.guestApplication.update({ where: { id }, data });
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

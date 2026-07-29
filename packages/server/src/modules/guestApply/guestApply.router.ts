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
  weeklySchedule: true,
  guestApplyEnabled: true,
  guestApplyDeadlineHours: true,
  maxGuestsPerDay: true,
  homeFacility: { select: { address: true } },
  _count: { select: { members: true } },
} as const;

type ClubPreviewRow = {
  id: string; name: string; description: string | null; guestFee: number | null;
  duesAccountInfo: string | null; visibility: string;
  weeklySchedule: unknown; guestApplyEnabled: boolean;
  guestApplyDeadlineHours: number | null; maxGuestsPerDay: number | null;
  homeFacility: { address: string } | null; _count: { members: number };
};

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

interface WeeklySlot { day: number; start: string; end: string }
function parseSchedule(input: unknown): WeeklySlot[] {
  if (!Array.isArray(input)) return [];
  return (input as WeeklySlot[]).filter(
    (s) => Number.isInteger(s?.day) && s.day >= 0 && s.day <= 6 && /^\d{2}:\d{2}$/.test(String(s?.start)) && /^\d{2}:\d{2}$/.test(String(s?.end)),
  );
}

/** "매주 화·목 20:00~22:00" 요약. 요일별 시간이 다르면 "매주 화 20:00~22:00 · 토 10:00~13:00". */
function scheduleSummary(slots: WeeklySlot[]): string | null {
  if (slots.length === 0) return null;
  const sorted = [...slots].sort((a, b) => a.day - b.day);
  const days = [...new Set(sorted.map((s) => s.day))].map((d) => DAY_KO[d]).join('·');
  const times = [...new Set(sorted.map((s) => `${s.start}~${s.end}`))];
  if (times.length === 1) return `매주 ${days} ${times[0]}`;
  if (sorted.length <= 3) return `매주 ${sorted.map((s) => `${DAY_KO[s.day]} ${s.start}~${s.end}`).join(' · ')}`;
  return `매주 ${days}`;
}

export interface AvailableDate {
  date: string; // YYYY-MM-DD
  label: string; // "8/2 (토)"
  status: 'OPEN' | 'FULL' | 'CLOSED';
  remaining: number | null; // 정원 설정 시 남은 자리
}

/**
 * 게스트 신청 가능 날짜 계산 — 정책의 단일 소스.
 *  • 일정 설정 시: 다음 14일 중 운동 요일만. 미설정 시: 다음 7일 전부(호환).
 *  • 마감: 그 날 운동 시작 N시간 전(guestApplyDeadlineHours). null이면 시작 시각까지.
 *    (일정 미설정 모임은 그 날 00:00 기준 → 오늘은 항상 신청 가능으로 둔다.)
 *  • 정원: maxGuestsPerDay — 유효 신청(취소 제외) 수가 도달하면 FULL.
 */
async function computeAvailableDates(club: ClubPreviewRow, now = new Date()): Promise<AvailableDate[]> {
  if (!club.guestApplyEnabled) return [];
  const slots = parseSchedule(club.weeklySchedule);
  const horizon = slots.length > 0 ? 14 : 7;

  // 날짜별 유효 신청 수(취소 제외).
  const counts = new Map<string, number>();
  if (club.maxGuestsPerDay != null) {
    // 정원 카운트는 유효 신청(PENDING/CONFIRMED)만 — WAITLIST(대기)·CANCELLED 제외.
    const grouped = await prisma.guestApplication.groupBy({
      by: ['visitDate'],
      where: { clubId: club.id, status: { in: ['PENDING', 'CONFIRMED'] }, visitDate: { not: null } },
      _count: { _all: true },
    });
    for (const g of grouped) if (g.visitDate) counts.set(g.visitDate, g._count._all);
  }

  const out: AvailableDate[] = [];
  for (let i = 0; i < horizon; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const day = d.getDay();
    const daySlots = slots.filter((s) => s.day === day);
    if (slots.length > 0 && daySlots.length === 0) continue; // 운동 요일 아님

    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${d.getMonth() + 1}/${d.getDate()} (${DAY_KO[day]})`;

    // 마감 계산: 그 날의 가장 이른 시작 시각 - N시간. 일정 미설정이면 마감 없음(그 날 내내).
    let status: AvailableDate['status'] = 'OPEN';
    if (daySlots.length > 0) {
      const earliest = daySlots.map((s) => s.start).sort()[0];
      const [hh, mm] = earliest.split(':').map(Number);
      const startAt = new Date(d);
      startAt.setHours(hh, mm, 0, 0);
      const deadline = new Date(startAt.getTime() - (club.guestApplyDeadlineHours ?? 0) * 3600_000);
      if (now >= deadline) status = 'CLOSED';
    }

    let remaining: number | null = null;
    if (club.maxGuestsPerDay != null) {
      remaining = Math.max(0, club.maxGuestsPerDay - (counts.get(date) ?? 0));
      if (status === 'OPEN' && remaining <= 0) status = 'FULL';
    }

    out.push({ date, label, status, remaining });
  }
  return out;
}

async function toPreview(club: ClubPreviewRow) {
  const slots = parseSchedule(club.weeklySchedule);
  return {
    clubId: club.id,
    clubName: club.name,
    description: club.description,
    memberCount: club._count.members,
    region: club.homeFacility?.address ? club.homeFacility.address.split(' ').slice(0, 2).join(' ') : null,
    guestFee: club.guestFee,
    accountInfo: club.duesAccountInfo,
    scheduleSummary: scheduleSummary(slots),
    applyClosed: !club.guestApplyEnabled,
    availableDates: await computeAvailableDates(club),
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

  // 신청 정책 검증 — 받기 여부·가능일(요일/마감/정원)을 서버가 최종 판정.
  if (!club.guestApplyEnabled) throw new BadRequestError('지금은 게스트 신청을 받지 않아요');
  if (!validVisit) throw new BadRequestError('참석 희망일을 선택해 주세요');
  const available = await computeAvailableDates(club);
  const slot = available.find((a) => a.date === validVisit);
  if (!slot) throw new BadRequestError('신청할 수 없는 날짜예요 — 운동 요일을 확인해 주세요');
  if (slot.status === 'CLOSED') throw new BadRequestError('그 날 신청은 마감됐어요');
  // 정원이 찬 날짜는 거절하지 않고 '대기(WAITLIST)'로 접수 — 자리가 나면 자동 승격.
  const waitlisted = slot.status === 'FULL';

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
      ...(waitlisted ? { status: 'WAITLIST' } : {}),
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
    waitlisted,
    message: waitlisted
      ? `${club.name} 그 날은 정원이 차서 '대기'로 접수됐어요. 자리가 나면 알려드릴게요.`
      : club.guestFee
        ? `${club.name} 게스트 신청이 접수됐어요. 게스트비 ${club.guestFee.toLocaleString()}원을 입금하시면 확정됩니다.`
        : `${club.name} 게스트 신청이 접수됐어요. 운영자 확인 후 확정됩니다.`,
  });
}

// ── by-id (모임 찾기 진입 — PUBLIC 전용). '/:inviteCode'보다 먼저 선언. ──
router.get('/by-id/:clubId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await findPublicById(String(req.params.clubId));
    if (!club) throw new NotFoundError('모임');
    res.json(await toPreview(club));
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
    res.json(await toPreview(club));
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

import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';

// ─────────────────────────────────────────────────────────────
// 코치 마켓(숨고식) — 코치가 앱 계정으로 직접 등록·관리하는 프로필.
//  • 등록 즉시 활동(active=true). 최고관리자가 '인증 코치'(certified) 뱃지 부여.
//  • 목록/상세는 공개(비로그인 웹에서도 탐색 가능) — 연락은 코치 채팅(로그인)으로.
// ─────────────────────────────────────────────────────────────

export interface CoachCardDTO {
  id: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  intro: string | null;
  regions: string | null;
  pricePerMonth: number | null;
  pricePerSession: number | null;
  certified: boolean;
  lessonCount: number; // 연결된 진행중 레슨 수(신뢰 신호)
}

export interface CoachDetailDTO extends CoachCardDTO {
  career: string | null;
  availableTimes: string | null;
  active: boolean;
  createdAt: string;
}

export interface CoachProfileInput {
  displayName?: string;
  photoUrl?: string | null;
  intro?: string | null;
  career?: string | null;
  regions?: string | null;
  pricePerMonth?: number | null;
  pricePerSession?: number | null;
  availableTimes?: string | null;
  active?: boolean;
}

type CoachRow = {
  id: string; userId: string; displayName: string; photoUrl: string | null;
  intro: string | null; career: string | null; regions: string | null;
  pricePerMonth: number | null; pricePerSession: number | null;
  availableTimes: string | null; certified: boolean; active: boolean; createdAt: Date;
  _count?: { lessonOffers: number };
};

function toCard(c: CoachRow): CoachCardDTO {
  return {
    id: c.id,
    userId: c.userId,
    displayName: c.displayName,
    photoUrl: c.photoUrl,
    intro: c.intro,
    regions: c.regions,
    pricePerMonth: c.pricePerMonth,
    pricePerSession: c.pricePerSession,
    certified: c.certified,
    lessonCount: c._count?.lessonOffers ?? 0,
  };
}

function toDetail(c: CoachRow): CoachDetailDTO {
  return {
    ...toCard(c),
    career: c.career,
    availableTimes: c.availableTimes,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
  };
}

const offerCount = { _count: { select: { lessonOffers: { where: { enabled: true } } } } } as const;

/** 공개 코치 목록 — 인증 코치 우선, 최근 갱신 순. region/q 는 부분 일치 필터. */
export async function listCoaches(filter: { region?: string; q?: string }): Promise<CoachCardDTO[]> {
  const region = filter.region?.trim();
  const q = filter.q?.trim();
  const rows = await prisma.coachProfile.findMany({
    where: {
      active: true,
      ...(region ? { regions: { contains: region, mode: 'insensitive' } } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { intro: { contains: q, mode: 'insensitive' } },
              { career: { contains: q, mode: 'insensitive' } },
              { regions: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ certified: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    include: offerCount,
  });
  return rows.map(toCard);
}

/** 공개 코치 상세. 비활성 프로필은 본인만 볼 수 있다. */
export async function getCoach(id: string, viewerUserId?: string): Promise<CoachDetailDTO> {
  const c = await prisma.coachProfile.findUnique({ where: { id }, include: offerCount });
  if (!c || (!c.active && c.userId !== viewerUserId)) throw new NotFoundError('코치');
  return toDetail(c);
}

/** 내 코치 프로필(없으면 null — 아직 코치로 등록 안 한 상태). */
export async function getMyCoachProfile(userId: string): Promise<CoachDetailDTO | null> {
  const c = await prisma.coachProfile.findUnique({ where: { userId }, include: offerCount });
  return c ? toDetail(c) : null;
}

function clamp(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function toPrice(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new BadRequestError('가격이 올바르지 않습니다');
  return Math.round(n);
}

/** 내 코치 프로필 등록/수정(업서트). 등록 즉시 활동 상태가 된다. */
export async function upsertMyCoachProfile(userId: string, input: CoachProfileInput): Promise<CoachDetailDTO> {
  const displayName = clamp(input.displayName, 30);
  const data = {
    photoUrl: clamp(input.photoUrl, 300),
    intro: clamp(input.intro, 200),
    career: clamp(input.career, 2000),
    regions: clamp(input.regions, 200),
    pricePerMonth: toPrice(input.pricePerMonth),
    pricePerSession: toPrice(input.pricePerSession),
    availableTimes: clamp(input.availableTimes, 500),
    ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
  };

  const existing = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!existing && !displayName) throw new BadRequestError('코치 이름을 입력해 주세요');

  const c = existing
    ? await prisma.coachProfile.update({
        where: { userId },
        data: { ...(displayName ? { displayName } : {}), ...data },
        include: offerCount,
      })
    : await prisma.coachProfile.create({
        data: { userId, displayName: displayName!, ...data },
        include: offerCount,
      });
  return toDetail(c);
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export interface MyCoachLessonRow {
  offerId: string;
  clubId: string;
  clubName: string;
  summary: string; // "월·수 19:00~20:00"
  fee: number | null;
  capacity: number | null;
  enabled: boolean;
  students: number; // PENDING+CONFIRMED
}

/** 코치 본인: 내가 연결된 레슨 목록(클럽별) — 로스터·출석 진입점. */
export async function listMyCoachLessons(userId: string): Promise<MyCoachLessonRow[]> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return [];
  const offers = await prisma.lessonOffer.findMany({
    where: { coachProfileId: profile.id },
    orderBy: [{ enabled: 'desc' }, { day: 'asc' }, { start: 'asc' }],
    include: {
      club: { select: { id: true, name: true } },
      _count: { select: { applications: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } } } },
    },
  });
  return offers.map((o) => {
    const raw = Array.isArray(o.days) ? (o.days as unknown[]) : [];
    const ds = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const dayList = (ds.length > 0 ? ds : [o.day]).map((d) => DAY_KO[d]).join('·');
    return {
      offerId: o.id,
      clubId: o.club.id,
      clubName: o.club.name,
      summary: `${dayList} ${o.start}~${o.end}`,
      fee: o.fee,
      capacity: o.capacity,
      enabled: o.enabled,
      students: o._count.applications,
    };
  });
}

/** 최고관리자: 인증 코치 뱃지 부여/회수. */
export async function setCoachCertified(id: string, certified: boolean): Promise<CoachDetailDTO> {
  const existing = await prisma.coachProfile.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('코치');
  const c = await prisma.coachProfile.update({ where: { id }, data: { certified }, include: offerCount });
  return toDetail(c);
}

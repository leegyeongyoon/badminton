import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';

// ─────────────────────────────────────────────────────────────
// 코치 마켓(숨고식) — 코치가 앱 계정으로 직접 등록·관리하는 프로필.
//  • 등록 즉시 활동(active=true). 최고관리자가 '인증 코치'(certified) 뱃지 부여.
//  • 목록/상세는 공개(비로그인 웹에서도 탐색 가능) — 연락은 코치 채팅(로그인)으로.
// ─────────────────────────────────────────────────────────────

// 시/도 지역 코드(표준 17개) — 프로필·공고의 복수 선택 및 필터 기준.
export const REGION_CODES = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

function sanitizeRegionCodes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [...new Set(raw.map((v) => String(v ?? '').trim()))].filter((v) => REGION_CODES.includes(v));
  return out.length > 0 ? out : null;
}

/** ?regions=서울,경기 → 검증된 코드 배열. */
export function parseRegionsParam(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return sanitizeRegionCodes(raw.split(','));
}

export interface CoachCardDTO {
  id: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  intro: string | null;
  regions: string | null; // 상세 지역 텍스트
  regionCodes: string[]; // 시/도 복수 선택
  pricePerMonth: number | null;
  pricePerSession: number | null;
  certified: boolean;
  lessonCount: number; // 연결된 진행중 레슨 수(신뢰 신호)
  // 이력서 기본 정보(원티드식)
  birthYear: number | null;
  playingYears: number | null;
  skillLevel: string | null; // S~F
  awardCount: number; // 입상 기록 수(신뢰 라인)
}

export interface CareerEntryDTO {
  id: string;
  kind: string; // PLAYER | COACH | EDUCATION | CERT | AWARD
  title: string;
  org: string | null;
  startYm: string | null; // "YYYY-MM"
  endYm: string | null; // null = 현재
  description: string | null;
  division: string | null; // 입상 부문(남단·여단·남복·여복·혼복·단체전)
  result: string | null; // 입상 성적(우승·준우승·3위·입상)
}

export interface CoachDetailDTO extends CoachCardDTO {
  career: string | null;
  availableTimes: string | null;
  active: boolean;
  createdAt: string;
  careerEntries: CareerEntryDTO[]; // 원티드식 구조화 이력서(있으면 career 텍스트보다 우선)
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
  regionCodes?: string[] | null;
  birthYear?: number | null;
  playingYears?: number | null;
  skillLevel?: string | null;
}

type CareerEntryRow = {
  id: string; kind: string; title: string; org: string | null;
  startYm: string | null; endYm: string | null; description: string | null;
  division: string | null; result: string | null;
};

type CoachRow = {
  id: string; userId: string; displayName: string; photoUrl: string | null;
  intro: string | null; career: string | null; regions: string | null;
  pricePerMonth: number | null; pricePerSession: number | null;
  availableTimes: string | null; certified: boolean; active: boolean; createdAt: Date;
  birthYear: number | null; playingYears: number | null; skillLevel: string | null;
  regionCodes: unknown;
  _count?: { lessonOffers: number; careerEntries?: number };
  careerEntries?: CareerEntryRow[];
};

function toEntryDTO(e: CareerEntryRow): CareerEntryDTO {
  return {
    id: e.id, kind: e.kind, title: e.title, org: e.org, startYm: e.startYm, endYm: e.endYm,
    description: e.description, division: e.division, result: e.result,
  };
}

function toCard(c: CoachRow): CoachCardDTO {
  return {
    id: c.id,
    userId: c.userId,
    displayName: c.displayName,
    photoUrl: c.photoUrl,
    intro: c.intro,
    regions: c.regions,
    regionCodes: sanitizeRegionCodes(c.regionCodes) ?? [],
    pricePerMonth: c.pricePerMonth,
    pricePerSession: c.pricePerSession,
    certified: c.certified,
    lessonCount: c._count?.lessonOffers ?? 0,
    birthYear: c.birthYear,
    playingYears: c.playingYears,
    skillLevel: c.skillLevel,
    awardCount: c._count?.careerEntries ?? 0,
  };
}

function toDetail(c: CoachRow): CoachDetailDTO {
  return {
    ...toCard(c),
    career: c.career,
    availableTimes: c.availableTimes,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
    careerEntries: (c.careerEntries ?? []).map(toEntryDTO),
  };
}

// 카드 공통 카운트: 진행중 레슨 수 + 입상(AWARD) 수 — 숨고식 신뢰 라인용.
const offerCount = {
  _count: {
    select: {
      lessonOffers: { where: { enabled: true } },
      careerEntries: { where: { kind: 'AWARD' } },
    },
  },
} as const;
// 상세 조회용 include — 이력서 엔트리 포함(정렬: order → 시작 시점 최신).
const detailInclude = {
  ...offerCount,
  careerEntries: { orderBy: [{ order: 'asc' as const }, { startYm: 'desc' as const }] },
};

/** 공개 코치 목록 — 인증 코치 우선, 최근 갱신 순. region/q 는 부분 일치 필터. */
export async function listCoaches(filter: { region?: string; q?: string; regions?: string[] | null }): Promise<CoachCardDTO[]> {
  const region = filter.region?.trim();
  const q = filter.q?.trim();
  const codes = filter.regions ?? null;
  const rows = await prisma.coachProfile.findMany({
    where: {
      active: true,
      // 시/도 복수 선택 필터 — 선택된 코드 중 하나라도 포함하면 매칭.
      ...(codes && codes.length > 0
        ? { OR: codes.map((c) => ({ regionCodes: { array_contains: c } })) }
        : {}),
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
  const c = await prisma.coachProfile.findUnique({ where: { id }, include: detailInclude });
  if (!c || (!c.active && c.userId !== viewerUserId)) throw new NotFoundError('코치');
  return toDetail(c);
}

/** 내 코치 프로필(없으면 null — 아직 코치로 등록 안 한 상태). */
export async function getMyCoachProfile(userId: string): Promise<CoachDetailDTO | null> {
  const c = await prisma.coachProfile.findUnique({ where: { userId }, include: detailInclude });
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

  // 이력서 기본 정보 검증 — 출생연도·구력·급수(앱 공용 S~F).
  let birthYear: number | null = null;
  if (input.birthYear != null && input.birthYear !== ('' as never)) {
    const y = Number(input.birthYear);
    const nowYear = new Date().getFullYear();
    if (!Number.isInteger(y) || y < 1930 || y > nowYear - 10) throw new BadRequestError('출생연도가 올바르지 않아요');
    birthYear = y;
  }
  let playingYears: number | null = null;
  if (input.playingYears != null && input.playingYears !== ('' as never)) {
    const n = Number(input.playingYears);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new BadRequestError('구력(년)이 올바르지 않아요');
    playingYears = n;
  }
  let skillLevel: string | null = null;
  if (input.skillLevel) {
    const lv = String(input.skillLevel).toUpperCase();
    if (!['S', 'A', 'B', 'C', 'D', 'E', 'F'].includes(lv)) throw new BadRequestError('급수가 올바르지 않아요');
    skillLevel = lv;
  }

  // 부분 업데이트: 요청에 없는(undefined) 필드는 건드리지 않는다 — 이력서 화면이
  // 기본 정보만 저장할 때 사진·소개·지역이 null 로 지워지던 버그 방지.
  const data = {
    ...(input.photoUrl !== undefined ? { photoUrl: clamp(input.photoUrl, 300) } : {}),
    ...(input.intro !== undefined ? { intro: clamp(input.intro, 200) } : {}),
    ...(input.career !== undefined ? { career: clamp(input.career, 2000) } : {}),
    ...(input.regions !== undefined ? { regions: clamp(input.regions, 200) } : {}),
    ...(input.pricePerMonth !== undefined ? { pricePerMonth: toPrice(input.pricePerMonth) } : {}),
    ...(input.pricePerSession !== undefined ? { pricePerSession: toPrice(input.pricePerSession) } : {}),
    ...(input.availableTimes !== undefined ? { availableTimes: clamp(input.availableTimes, 500) } : {}),
    ...(input.regionCodes !== undefined ? { regionCodes: sanitizeRegionCodes(input.regionCodes) ?? [] } : {}),
    ...(input.birthYear !== undefined ? { birthYear } : {}),
    ...(input.playingYears !== undefined ? { playingYears } : {}),
    ...(input.skillLevel !== undefined ? { skillLevel } : {}),
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

// ── 원티드식 이력서(경력 엔트리) ─────────────────────────────
const CAREER_KINDS = ['PLAYER', 'COACH', 'EDUCATION', 'CERT', 'AWARD'];
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CareerEntryInput {
  kind?: string;
  title?: string;
  org?: string | null;
  startYm?: string | null;
  endYm?: string | null;
  description?: string | null;
  division?: string | null;
  result?: string | null;
}

/** 내 이력서 엔트리 목록. */
export async function getMyCareer(userId: string): Promise<CareerEntryDTO[]> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return [];
  const rows = await prisma.coachCareerEntry.findMany({
    where: { coachProfileId: profile.id },
    orderBy: [{ order: 'asc' }, { startYm: 'desc' }],
  });
  return rows.map(toEntryDTO);
}

/** 내 이력서 일괄 저장(전체 교체) — 화면에서 편집한 목록을 그대로 반영. */
export async function setMyCareer(userId: string, entries: CareerEntryInput[]): Promise<CareerEntryDTO[]> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new BadRequestError('먼저 코치 프로필을 등록해 주세요');
  if (!Array.isArray(entries) || entries.length > 50) throw new BadRequestError('이력 항목이 올바르지 않아요');

  const rows = entries.map((e, i) => {
    const kind = String(e.kind ?? '');
    const title = clamp(e.title, 80);
    if (!CAREER_KINDS.includes(kind)) throw new BadRequestError('이력 유형이 올바르지 않아요');
    if (!title) throw new BadRequestError('이력 제목을 입력해 주세요');
    const startYm = e.startYm && YM.test(String(e.startYm)) ? String(e.startYm) : null;
    const endYm = e.endYm && YM.test(String(e.endYm)) ? String(e.endYm) : null;
    return {
      coachProfileId: profile.id,
      kind,
      title,
      org: clamp(e.org, 60),
      startYm,
      endYm,
      description: clamp(e.description, 300),
      division: kind === 'AWARD' ? clamp(e.division, 20) : null,
      result: kind === 'AWARD' ? clamp(e.result, 20) : null,
      order: i,
    };
  });

  await prisma.$transaction([
    prisma.coachCareerEntry.deleteMany({ where: { coachProfileId: profile.id } }),
    ...(rows.length > 0 ? [prisma.coachCareerEntry.createMany({ data: rows })] : []),
  ]);
  return getMyCareer(userId);
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

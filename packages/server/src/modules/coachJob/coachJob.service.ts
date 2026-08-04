import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { sendPushToUser, sendPushToUsers } from '../notification/notification.service';
import { verifyClubStaff } from '../clubSession/clubSession.service';
import { REGION_CODES, parseRegionsParam } from '../coach/coach.service';

export { parseRegionsParam };

function sanitizeRegionCodes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [...new Set(raw.map((v) => String(v ?? '').trim()))].filter((v) => REGION_CODES.includes(v));
  return out.length > 0 ? out : null;
}
import * as coachChat from '../coachChat/coachChat.service';

// ─────────────────────────────────────────────────────────────
// 코치 구인 공고 + 원티드식 지원 관리.
//  • 공고: 누구나 작성. clubId 있으면 클럽 명의(그 클럽 운영진만), null=개인 요청.
//  • 지원: 코치 프로필(이력서) 필수. 공고당 1회(철회 후 재지원 가능).
//  • 상태: APPLIED → INTERVIEW(면접 제안: 채팅 자동 생성) → ACCEPTED | REJECTED.
//    WITHDRAWN 은 코치 본인만. 역방향 전이 금지.
// ─────────────────────────────────────────────────────────────

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface JobPostCard {
  id: string;
  title: string;
  clubId: string | null;
  clubName: string | null; // null = 개인 요청
  region: string; // 표시 라벨(시/도 조합, 폴백 상세 텍스트)
  regionCodes: string[]; // 시/도 복수 선택
  regionDetail: string | null; // 상세 위치(체육관 등)
  scheduleLabel: string; // "월·수 19:00~20:00" 또는 "협의"
  payLabel: string; // "월 200,000원" | "회당 50,000원" | "협의"
  thumbnail: string | null; // 첫 첨부 사진(피드 카드용)
  status: string;
  applicants: number;
  createdAt: string;
}

// 오퍼레터 조건 — 공고측이 제시하는 최종 채용 조건.
export interface OfferTerms {
  payMonthly?: number | null;
  paySession?: number | null;
  days?: number[] | null;
  start?: string | null;
  end?: string | null;
  startNote?: string | null; // 시작 시기·기타(자유 텍스트)
  message?: string | null;
}

function sanitizeOffer(raw: unknown): OfferTerms {
  const o = (raw ?? {}) as OfferTerms;
  const start = o.start && HHMM.test(String(o.start)) ? String(o.start) : null;
  const end = o.end && HHMM.test(String(o.end)) ? String(o.end) : null;
  const terms: OfferTerms = {
    payMonthly: toPay(o.payMonthly),
    paySession: toPay(o.paySession),
    days: sanitizeDays(o.days),
    start,
    end,
    startNote: clamp(o.startNote, 100),
    message: clamp(o.message, 500),
  };
  if (terms.payMonthly == null && terms.paySession == null) {
    throw new BadRequestError('오퍼레터에는 급여(월 또는 회당)를 명시해 주세요');
  }
  return terms;
}

export interface JobApplicantRow {
  id: string; // applicationId
  coachProfileId: string;
  coachUserId: string;
  displayName: string;
  photoUrl: string | null;
  certified: boolean;
  intro: string | null;
  regions: string | null;
  // 이력서 기본 정보 — 지원자 카드에서 바로 판단할 1차 기준.
  birthYear: number | null;
  playingYears: number | null;
  skillLevel: string | null;
  careerSummary: string | null; // 최근 경력 1줄
  message: string | null;
  status: string;
  offerTerms: OfferTerms | null;
  offerSentAt: string | null;
  // 면접 안내(코치에게도 노출) + 공고측 전용 운영 메모.
  interviewWhen: string | null;
  interviewPlace: string | null;
  interviewNote: string | null;
  managerNote: string | null;
  createdAt: string;
}

export interface JobPostDetail extends JobPostCard {
  description: string | null;
  days: number[] | null;
  start: string | null;
  end: string | null;
  payMonthly: number | null;
  paySession: number | null;
  payNegotiable: boolean;
  requirements: string | null;
  photos: string[]; // 모집공고 첨부 사진(체육관·코트 등)
  attachments: JobAttachment[]; // 모집 요강 등 첨부 문서
  externalUrl: string | null; // 원문 공고 링크
  authorUserId: string;
  authorName: string;
  canManage: boolean; // 작성자 또는 그 클럽 운영진
  myApplication: {
    id: string; status: string; message: string | null;
    offerTerms: OfferTerms | null; offerSentAt: string | null;
    interviewWhen: string | null; interviewPlace: string | null; interviewNote: string | null;
  } | null; // 코치 시점(managerNote 는 비노출)
  /** 코치 시점 — 이 공고에서 나에게 제안(스카웃)을 보냈는지. */
  invited: boolean;
  applications: JobApplicantRow[] | null; // canManage 일 때만
}

export interface JobPostInput {
  clubId?: string | null;
  photos?: string[] | null;
  regionCodes?: string[] | null;
  title?: string;
  description?: string | null;
  days?: number[] | null;
  start?: string | null;
  end?: string | null;
  payMonthly?: number | null;
  paySession?: number | null;
  payNegotiable?: boolean;
  region?: string;
  requirements?: string | null;
  attachments?: { url: string; name: string }[] | null;
  externalUrl?: string | null;
  status?: string;
}

function clamp(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function toPay(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new BadRequestError('급여가 올바르지 않습니다');
  return Math.round(n);
}

// 첨부 사진 정제 — 우리 업로드 경로(/uploads/*)만 허용, 최대 5장.
function sanitizePhotos(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((v) => String(v ?? '').trim())
    .filter((v) => /^\/uploads\/[A-Za-z0-9._-]+$/.test(v))
    .slice(0, 5);
  return out.length > 0 ? out : null;
}

// 첨부 문서 [{url, name}] — 우리 업로드 문서 경로만, 최대 3개.
export interface JobAttachment { url: string; name: string }
function sanitizeAttachments(raw: unknown): JobAttachment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: JobAttachment[] = [];
  for (const item of raw.slice(0, 3)) {
    const url = String((item as JobAttachment)?.url ?? '').trim();
    const name = String((item as JobAttachment)?.name ?? '').trim().slice(0, 120) || '첨부파일';
    if (/^\/uploads\/[A-Za-z0-9._-]+\.(pdf|hwp|hwpx|doc|docx)$/.test(url)) out.push({ url, name });
  }
  return out.length > 0 ? out : null;
}

// 원문 공고 링크 — http(s)만, 500자.
function sanitizeExternalUrl(raw: unknown): string | null {
  const v = clamp(raw, 500);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return v;
  } catch {
    return null;
  }
}

function sanitizeDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return out.length > 0 ? out : null;
}

function scheduleLabel(days: number[] | null, start: string | null, end: string | null): string {
  const d = days && days.length > 0 ? days.map((x) => DAY_KO[x]).join('·') : null;
  const t = start && end ? `${start}~${end}` : null;
  if (!d && !t) return '요일·시간 협의';
  return [d, t].filter(Boolean).join(' ');
}

function payLabel(p: { payMonthly: number | null; paySession: number | null; payNegotiable: boolean }): string {
  if (p.payMonthly) return `월 ${p.payMonthly.toLocaleString()}원${p.payNegotiable ? ' (협의 가능)' : ''}`;
  if (p.paySession) return `회당 ${p.paySession.toLocaleString()}원${p.payNegotiable ? ' (협의 가능)' : ''}`;
  return '급여 협의';
}

type PostRow = {
  id: string; authorUserId: string; clubId: string | null; title: string; description: string | null;
  days: unknown; start: string | null; end: string | null;
  payMonthly: number | null; paySession: number | null; payNegotiable: boolean;
  region: string; regionCodes: unknown; requirements: string | null; photos: unknown; status: string; createdAt: Date;
  _count?: { applications: number };
};

async function clubNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const clubIds = [...new Set(ids.filter(Boolean))] as string[];
  if (clubIds.length === 0) return new Map();
  const clubs = await prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true } });
  return new Map(clubs.map((c) => [c.id, c.name]));
}

function toCard(p: PostRow, clubMap: Map<string, string>): JobPostCard {
  const days = sanitizeDays(p.days);
  const codes = sanitizeRegionCodes(p.regionCodes) ?? [];
  return {
    id: p.id,
    title: p.title,
    clubId: p.clubId,
    clubName: p.clubId ? clubMap.get(p.clubId) ?? null : null,
    // 표시: 시/도 조합 우선, 상세는 괄호 느낌으로 뒤에. 레거시(코드 없음)는 텍스트 그대로.
    region: codes.length > 0 ? [codes.join('·'), p.region].filter(Boolean).join(' · ') : p.region,
    regionCodes: codes,
    regionDetail: p.region || null,
    scheduleLabel: scheduleLabel(days, p.start, p.end),
    payLabel: payLabel(p),
    thumbnail: sanitizePhotos(p.photos)?.[0] ?? null,
    status: p.status,
    applicants: p._count?.applications ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
}

/** 작성자이거나, 클럽 명의 공고면 그 클럽 운영진(또는 SUPER_ADMIN)인지. */
async function canManagePost(post: { authorUserId: string; clubId: string | null }, userId: string): Promise<boolean> {
  if (post.authorUserId === userId) return true;
  if (!post.clubId) return false;
  try {
    await verifyClubStaff(post.clubId, userId);
    return true;
  } catch {
    return false;
  }
}

// 지원 카운트는 철회 제외 — 카드의 "지원 N명"이 실제 검토 대상 수가 되게.
const activeAppCount = { _count: { select: { applications: { where: { status: { not: 'WITHDRAWN' } } } } } } as const;

/** 공개 피드 — OPEN 공고, 최신순. region/q 부분 일치 필터. */
export async function listJobs(filter: { region?: string; q?: string; regions?: string[] | null }): Promise<JobPostCard[]> {
  const region = filter.region?.trim();
  const q = filter.q?.trim();
  const codes = filter.regions ?? null;
  const rows = await prisma.coachJobPost.findMany({
    where: {
      status: 'OPEN',
      ...(codes && codes.length > 0
        ? { OR: codes.map((c) => ({ regionCodes: { array_contains: c } })) }
        : {}),
      ...(region ? { region: { contains: region, mode: 'insensitive' } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { region: { contains: q, mode: 'insensitive' } },
              { requirements: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: activeAppCount,
  });
  const clubMap = await clubNames(rows.map((r) => r.clubId));
  return rows.map((r) => toCard(r, clubMap));
}

/** 공고 상세 — canManage 면 지원자 목록, 코치면 내 지원 상태 포함. */
export async function getJob(id: string, viewerUserId?: string): Promise<JobPostDetail> {
  const post = await prisma.coachJobPost.findUnique({ where: { id }, include: activeAppCount });
  if (!post) throw new NotFoundError('공고');

  const clubMap = await clubNames([post.clubId]);
  const author = await prisma.user.findUnique({ where: { id: post.authorUserId }, select: { name: true } });
  const canManage = viewerUserId ? await canManagePost(post, viewerUserId) : false;

  let applications: JobApplicantRow[] | null = null;
  if (canManage) {
    const apps = await prisma.coachJobApplication.findMany({
      where: { postId: id, status: { not: 'WITHDRAWN' } },
      orderBy: { createdAt: 'asc' },
      include: {
        coachProfile: {
          select: {
            id: true, userId: true, displayName: true, photoUrl: true, certified: true,
            intro: true, regions: true, career: true,
            birthYear: true, playingYears: true, skillLevel: true,
            careerEntries: { orderBy: [{ order: 'asc' }], take: 1, select: { title: true, org: true } },
          },
        },
      },
    });
    applications = apps.map((a) => ({
      id: a.id,
      coachProfileId: a.coachProfile.id,
      coachUserId: a.coachProfile.userId,
      displayName: a.coachProfile.displayName,
      photoUrl: a.coachProfile.photoUrl,
      certified: a.coachProfile.certified,
      intro: a.coachProfile.intro,
      regions: a.coachProfile.regions,
      birthYear: a.coachProfile.birthYear,
      playingYears: a.coachProfile.playingYears,
      skillLevel: a.coachProfile.skillLevel,
      careerSummary:
        a.coachProfile.careerEntries[0]
          ? [a.coachProfile.careerEntries[0].org, a.coachProfile.careerEntries[0].title].filter(Boolean).join(' · ')
          : a.coachProfile.career?.split('\n')[0]?.trim() || null,
      message: a.message,
      status: a.status,
      offerTerms: (a.offerTerms as OfferTerms | null) ?? null,
      offerSentAt: a.offerSentAt?.toISOString() ?? null,
      interviewWhen: a.interviewWhen,
      interviewPlace: a.interviewPlace,
      interviewNote: a.interviewNote,
      managerNote: a.managerNote,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  let myApplication: JobPostDetail['myApplication'] = null;
  let invited = false;
  if (viewerUserId && !canManage) {
    const myProfile = await prisma.coachProfile.findUnique({ where: { userId: viewerUserId }, select: { id: true } });
    if (myProfile) {
      const inv = await prisma.coachJobInvite.findUnique({
        where: { postId_coachProfileId: { postId: id, coachProfileId: myProfile.id } },
        select: { status: true },
      });
      invited = inv?.status === 'SENT';
      const app = await prisma.coachJobApplication.findUnique({
        where: { postId_coachProfileId: { postId: id, coachProfileId: myProfile.id } },
        select: {
          id: true, status: true, message: true, offerTerms: true, offerSentAt: true,
          interviewWhen: true, interviewPlace: true, interviewNote: true,
        },
      });
      if (app && app.status !== 'WITHDRAWN') {
        myApplication = {
          id: app.id,
          status: app.status,
          message: app.message,
          offerTerms: (app.offerTerms as OfferTerms | null) ?? null,
          offerSentAt: app.offerSentAt?.toISOString() ?? null,
          interviewWhen: app.interviewWhen,
          interviewPlace: app.interviewPlace,
          interviewNote: app.interviewNote,
        };
      }
    }
  }

  const days = sanitizeDays(post.days);
  return {
    ...toCard(post, clubMap),
    description: post.description,
    days,
    start: post.start,
    end: post.end,
    payMonthly: post.payMonthly,
    paySession: post.paySession,
    payNegotiable: post.payNegotiable,
    requirements: post.requirements,
    photos: sanitizePhotos(post.photos) ?? [],
    attachments: sanitizeAttachments(post.attachments) ?? [],
    externalUrl: post.externalUrl,
    authorUserId: post.authorUserId,
    authorName: author?.name || '작성자',
    canManage,
    myApplication,
    invited,
    applications,
  };
}

/** 공고 작성. 클럽 명의(clubId)면 그 클럽 운영진만. */
export async function createJob(userId: string, input: JobPostInput): Promise<string> {
  const title = clamp(input.title, 60);
  const region = clamp(input.region, 60);
  const regionCodes = sanitizeRegionCodes(input.regionCodes);
  if (!title) throw new BadRequestError('공고 제목을 입력해 주세요');
  if (!regionCodes) throw new BadRequestError('지역(시/도)을 선택해 주세요');

  if (input.clubId) {
    await verifyClubStaff(String(input.clubId), userId); // 실패 시 Forbidden throw
  }
  const start = input.start && HHMM.test(String(input.start)) ? String(input.start) : null;
  const end = input.end && HHMM.test(String(input.end)) ? String(input.end) : null;

  const created = await prisma.coachJobPost.create({
    data: {
      authorUserId: userId,
      clubId: input.clubId ? String(input.clubId) : null,
      title,
      description: clamp(input.description, 2000),
      days: sanitizeDays(input.days) ?? undefined,
      start,
      end,
      payMonthly: toPay(input.payMonthly),
      paySession: toPay(input.paySession),
      payNegotiable: !!input.payNegotiable,
      region: region ?? '',
      regionCodes,
      requirements: clamp(input.requirements, 500),
      photos: sanitizePhotos(input.photos) ?? undefined,
      attachments: (sanitizeAttachments(input.attachments) ?? undefined) as never,
      externalUrl: sanitizeExternalUrl(input.externalUrl),
    },
  });
  return created.id;
}

/** 공고 수정·마감(OPEN/CLOSED 토글 포함). */
export async function updateJob(id: string, userId: string, patch: JobPostInput): Promise<void> {
  const post = await prisma.coachJobPost.findUnique({ where: { id }, select: { authorUserId: true, clubId: true } });
  if (!post) throw new NotFoundError('공고');
  if (!(await canManagePost(post, userId))) throw new ForbiddenError();

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = clamp(patch.title, 60);
    if (!t) throw new BadRequestError('공고 제목을 입력해 주세요');
    data.title = t;
  }
  if (patch.description !== undefined) data.description = clamp(patch.description, 2000);
  if (patch.days !== undefined) data.days = sanitizeDays(patch.days) ?? undefined;
  if (patch.start !== undefined) data.start = patch.start && HHMM.test(String(patch.start)) ? String(patch.start) : null;
  if (patch.end !== undefined) data.end = patch.end && HHMM.test(String(patch.end)) ? String(patch.end) : null;
  if (patch.payMonthly !== undefined) data.payMonthly = toPay(patch.payMonthly);
  if (patch.paySession !== undefined) data.paySession = toPay(patch.paySession);
  if (patch.payNegotiable !== undefined) data.payNegotiable = !!patch.payNegotiable;
  if (patch.region !== undefined) data.region = clamp(patch.region, 60) ?? '';
  if (patch.regionCodes !== undefined) {
    const codes = sanitizeRegionCodes(patch.regionCodes);
    if (!codes) throw new BadRequestError('지역(시/도)을 선택해 주세요');
    data.regionCodes = codes;
  }
  if (patch.requirements !== undefined) data.requirements = clamp(patch.requirements, 500);
  if (patch.photos !== undefined) data.photos = sanitizePhotos(patch.photos) ?? [];
  if (patch.attachments !== undefined) data.attachments = (sanitizeAttachments(patch.attachments) ?? []) as never;
  if (patch.externalUrl !== undefined) data.externalUrl = sanitizeExternalUrl(patch.externalUrl);
  if (patch.status !== undefined) {
    if (!['OPEN', 'CLOSED'].includes(String(patch.status))) throw new BadRequestError('잘못된 상태예요');
    data.status = patch.status;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.coachJobPost.update({ where: { id }, data });
}

export async function deleteJob(id: string, userId: string): Promise<void> {
  const post = await prisma.coachJobPost.findUnique({ where: { id }, select: { authorUserId: true, clubId: true } });
  if (!post) throw new NotFoundError('공고');
  if (!(await canManagePost(post, userId))) throw new ForbiddenError();
  await prisma.coachJobPost.delete({ where: { id } });
}

/** 지원 — 코치 프로필(이력서) 필수. 철회했던 공고는 재지원 가능. */
export async function applyJob(postId: string, userId: string, message?: string | null): Promise<{ id: string }> {
  const post = await prisma.coachJobPost.findUnique({ where: { id: postId } });
  if (!post || post.status !== 'OPEN') throw new BadRequestError('지원할 수 없는 공고예요');
  if (post.authorUserId === userId) throw new BadRequestError('내가 올린 공고에는 지원할 수 없어요');

  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true, displayName: true } });
  if (!profile) throw new BadRequestError('먼저 코치 이력서(프로필)를 등록해 주세요');

  const msg = clamp(message, 500);
  const existing = await prisma.coachJobApplication.findUnique({
    where: { postId_coachProfileId: { postId, coachProfileId: profile.id } },
  });

  let appId: string;
  if (existing) {
    if (existing.status !== 'WITHDRAWN') throw new BadRequestError('이미 지원한 공고예요');
    const updated = await prisma.coachJobApplication.update({
      where: { id: existing.id },
      data: { status: 'APPLIED', message: msg },
    });
    appId = updated.id;
  } else {
    const created = await prisma.coachJobApplication.create({
      data: { postId, coachProfileId: profile.id, message: msg },
    });
    appId = created.id;
  }

  // 작성자(+클럽 명의면 그 클럽 운영진)에게 지원 알림.
  try {
    const targets = new Set<string>([post.authorUserId]);
    if (post.clubId) {
      const staff = await prisma.clubMember.findMany({
        where: { clubId: post.clubId, role: { in: ['LEADER', 'STAFF'] } },
        select: { userId: true },
      });
      staff.forEach((s) => targets.add(s.userId));
    }
    await sendPushToUsers([...targets], {
      title: '코치 지원 도착 🏸',
      body: `${profile.displayName} 코치가 "${post.title}" 공고에 지원했어요`,
      data: { type: 'coachJobApply', postId },
    });
  } catch {
    /* 알림 실패 무시 */
  }
  return { id: appId };
}

// 원티드식 전이 규칙: 앞으로만. 합격은 오퍼레터(OFFERED)를 거쳐 코치가 수락해야 확정.
const TRANSITIONS: Record<string, string[]> = {
  APPLIED: ['INTERVIEW', 'OFFERED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['ACCEPTED', 'DECLINED', 'REJECTED'], // 수락/거절=코치 회신, REJECTED=공고측 철회
  ACCEPTED: [],
  REJECTED: [],
  DECLINED: [],
  WITHDRAWN: [], // 재지원은 applyJob 경로로만
};

const COACH_SIDE_STATUS = ['WITHDRAWN', 'ACCEPTED', 'DECLINED']; // 코치 본인만 가능한 전이

/**
 * 지원 상태 전이.
 *  • INTERVIEW/ACCEPTED/REJECTED: 공고 측(작성자·클럽 운영진)만.
 *    INTERVIEW 는 코치와의 채팅 스레드를 자동 생성하고 threadId 를 돌려준다.
 *  • WITHDRAWN: 지원한 코치 본인만.
 */
export async function updateApplicationStatus(
  postId: string,
  applicationId: string,
  requesterId: string,
  status: string,
  offer?: unknown,
  interview?: { when?: unknown; place?: unknown; note?: unknown } | null,
): Promise<{ threadId?: string }> {
  if (!['INTERVIEW', 'OFFERED', 'ACCEPTED', 'REJECTED', 'DECLINED', 'WITHDRAWN'].includes(status)) {
    throw new BadRequestError('잘못된 상태예요');
  }
  const app = await prisma.coachJobApplication.findUnique({
    where: { id: applicationId },
    include: { post: true, coachProfile: { select: { id: true, userId: true, displayName: true } } },
  });
  if (!app || app.postId !== postId) throw new NotFoundError('지원');

  if (!TRANSITIONS[app.status]?.includes(status)) {
    throw new BadRequestError('이미 확정된 지원이라 상태를 바꿀 수 없어요');
  }

  if (COACH_SIDE_STATUS.includes(status)) {
    if (app.coachProfile.userId !== requesterId) throw new ForbiddenError();
  } else {
    if (!(await canManagePost(app.post, requesterId))) throw new ForbiddenError();
    if (app.coachProfile.userId === requesterId) throw new BadRequestError('본인 지원은 공고 측에서 처리할 수 없어요');
  }

  // 오퍼레터 발송 — 조건 명시 필수.
  const offerData =
    status === 'OFFERED' ? { offerTerms: sanitizeOffer(offer) as never, offerSentAt: new Date() } : {};
  // 면접 전환 시 면접 안내(일시·장소·메모, 전부 선택) 함께 저장.
  const interviewData =
    status === 'INTERVIEW' && interview
      ? {
          interviewWhen: clamp(interview.when, 80),
          interviewPlace: clamp(interview.place, 120),
          interviewNote: clamp(interview.note, 300),
        }
      : {};

  await prisma.coachJobApplication.update({
    where: { id: applicationId },
    data: { status, ...offerData, ...interviewData },
  });

  let threadId: string | undefined;
  if (status === 'INTERVIEW' || status === 'OFFERED') {
    // 면접·오퍼 → 공고 담당자 ↔ 코치 1:1 채용 채팅 자동 생성(있으면 재사용).
    const view = await coachChat.startThread(requesterId, app.coachProfile.id, app.post.clubId, 'RECRUIT', postId);
    threadId = view.threadId;
  }

  // 푸시 — 공고측 액션은 코치에게, 코치 회신(수락/거절)은 공고 작성자에게.
  try {
    if (status === 'ACCEPTED' || status === 'DECLINED') {
      await sendPushToUser(app.post.authorUserId, {
        title: status === 'ACCEPTED' ? '오퍼 수락 — 채용 확정 🎉' : '오퍼가 거절됐어요',
        body:
          status === 'ACCEPTED'
            ? `${app.coachProfile.displayName} 코치가 "${app.post.title}" 오퍼레터를 수락했어요`
            : `${app.coachProfile.displayName} 코치가 오퍼를 정중히 거절했어요`,
        data: { type: 'coachJobOfferReply', postId, status },
      });
    } else if (status !== 'WITHDRAWN') {
      // 면접 안내가 있으면 일시·장소를 푸시 본문에 바로 담아준다.
      const iv = status === 'INTERVIEW' && interview ? [clamp(interview.when, 80), clamp(interview.place, 120)].filter(Boolean).join(' · ') : '';
      const pushMap: Record<string, { title: string; body: string }> = {
        INTERVIEW: {
          title: '면접 제안이 왔어요 💬',
          body: iv
            ? `"${app.post.title}" 면접 안내: ${iv} — 채팅에서 조율하세요`
            : `"${app.post.title}" 공고에서 면접(채팅)을 제안했어요`,
        },
        OFFERED: { title: '오퍼레터가 도착했어요 📄', body: `"${app.post.title}" 공고에서 채용 조건을 제시했어요 — 확인 후 회신해 주세요` },
        REJECTED: { title: '지원 결과 안내', body: `"${app.post.title}" 공고 지원이 아쉽게도 불합격 처리됐어요` },
      };
      await sendPushToUser(app.coachProfile.userId, {
        ...pushMap[status],
        data: { type: 'coachJobStatus', postId, status },
      });
    }
  } catch {
    /* 알림 실패 무시 */
  }
  return { threadId };
}

export interface MyJobRow extends JobPostCard {
  newApplicants: number; // 아직 처리 안 한 APPLIED 수
}

/** 내가 올린 공고(닫힌 것 포함) + 신규 지원 수. */
export async function listMyJobs(userId: string): Promise<MyJobRow[]> {
  const rows = await prisma.coachJobPost.findMany({
    where: { authorUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      _count: { select: { applications: { where: { status: { not: 'WITHDRAWN' } } } } },
      applications: { where: { status: 'APPLIED' }, select: { id: true } },
    },
  });
  const clubMap = await clubNames(rows.map((r) => r.clubId));
  return rows.map((r) => ({
    ...toCard(r, clubMap),
    newApplicants: (r as unknown as { applications: { id: string }[] }).applications.length,
  }));
}

export interface MyApplicationRow {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  post: JobPostCard;
  // 면접 안내(공고측이 입력) — 코치 지원 현황 카드에 표시.
  interviewWhen: string | null;
  interviewPlace: string | null;
  interviewNote: string | null;
}

/** 내(코치)가 지원한 공고 + 상태. */
export async function listMyApplications(userId: string): Promise<MyApplicationRow[]> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return [];
  const rows = await prisma.coachJobApplication.findMany({
    where: { coachProfileId: profile.id, status: { not: 'WITHDRAWN' } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { post: { include: activeAppCount } },
  });
  const clubMap = await clubNames(rows.map((r) => r.post.clubId));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    post: toCard(r.post, clubMap),
    interviewWhen: r.interviewWhen,
    interviewPlace: r.interviewPlace,
    interviewNote: r.interviewNote,
  }));
}

/**
 * 면접 안내 수정 — INTERVIEW 상태의 지원에 대해 공고측이 일시·장소·메모를
 * 다시 잡을 때. 변경 시 코치에게 갱신 푸시.
 */
export async function setApplicationInterview(
  postId: string,
  applicationId: string,
  requesterId: string,
  interview: { when?: unknown; place?: unknown; note?: unknown },
): Promise<void> {
  const app = await prisma.coachJobApplication.findUnique({
    where: { id: applicationId },
    include: { post: true, coachProfile: { select: { userId: true } } },
  });
  if (!app || app.postId !== postId) throw new NotFoundError('지원');
  if (!(await canManagePost(app.post, requesterId))) throw new ForbiddenError();
  if (app.status !== 'INTERVIEW') throw new BadRequestError('면접 단계의 지원만 안내를 수정할 수 있어요');

  const when = clamp(interview.when, 80);
  const place = clamp(interview.place, 120);
  await prisma.coachJobApplication.update({
    where: { id: applicationId },
    data: { interviewWhen: when, interviewPlace: place, interviewNote: clamp(interview.note, 300) },
  });
  try {
    const iv = [when, place].filter(Boolean).join(' · ');
    await sendPushToUser(app.coachProfile.userId, {
      title: '면접 안내가 변경됐어요 📅',
      body: iv ? `"${app.post.title}" 면접: ${iv}` : `"${app.post.title}" 면접 안내를 확인해 주세요`,
      data: { type: 'coachJobInterview', postId },
    });
  } catch { /* 알림 실패 무시 */ }
}

/** 지원자 운영 메모(공고측 전용) — 코치에게 노출되지 않는다. */
export async function setApplicationNote(
  postId: string,
  applicationId: string,
  requesterId: string,
  note: unknown,
): Promise<void> {
  const app = await prisma.coachJobApplication.findUnique({
    where: { id: applicationId },
    include: { post: true },
  });
  if (!app || app.postId !== postId) throw new NotFoundError('지원');
  if (!(await canManagePost(app.post, requesterId))) throw new ForbiddenError();
  await prisma.coachJobApplication.update({
    where: { id: applicationId },
    data: { managerNote: clamp(note, 1000) },
  });
}

// ─── 스카웃(공고 제안) ────────────────────────────────────────
// 공고 관리자가 '코치 찾기'에서 발견한 코치에게 자기 공고를 제안한다.
// 코치는 받은 제안 목록에서 공고를 확인하고 지원하거나 거절한다.

export interface JobInviteRow {
  id: string;
  message: string | null;
  status: string; // SENT | DECLINED
  createdAt: string;
  post: JobPostCard;
  /** 이 공고에 이미 지원했는지(지원했으면 제안 카드에서 '지원함' 표시). */
  applied: boolean;
}

/** 공고 제안 보내기 — 공고 관리자만, OPEN 공고만. 같은 코치에겐 1회(재전송 시 메시지 갱신). */
export async function inviteCoach(
  postId: string,
  requesterId: string,
  coachProfileId: string,
  message?: unknown,
): Promise<{ id: string }> {
  const post = await prisma.coachJobPost.findUnique({ where: { id: postId } });
  if (!post) throw new NotFoundError('공고');
  if (!(await canManagePost(post, requesterId))) throw new ForbiddenError();
  if (post.status !== 'OPEN') throw new BadRequestError('마감된 공고에는 제안할 수 없어요');

  const profile = await prisma.coachProfile.findUnique({
    where: { id: coachProfileId },
    select: { id: true, userId: true, displayName: true },
  });
  if (!profile) throw new NotFoundError('코치');
  if (profile.userId === requesterId) throw new BadRequestError('본인에게는 제안할 수 없어요');

  const msg = clamp(message, 300);
  const invite = await prisma.coachJobInvite.upsert({
    where: { postId_coachProfileId: { postId, coachProfileId } },
    create: { postId, coachProfileId, senderUserId: requesterId, message: msg },
    update: { message: msg ?? undefined, status: 'SENT' },
  });

  try {
    await sendPushToUser(profile.userId, {
      title: '함께하자는 제안이 왔어요 🤝',
      body: `"${post.title}" 공고에서 ${profile.displayName} 코치님께 제안을 보냈어요 — 공고를 확인해 보세요`,
      data: { type: 'coachJobInvite', postId },
    });
  } catch { /* 알림 실패 무시 */ }
  return { id: invite.id };
}

/** 내(코치)가 받은 제안 목록 — 최신순, 지원 여부 포함. */
export async function listMyInvites(userId: string): Promise<JobInviteRow[]> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return [];
  const rows = await prisma.coachJobInvite.findMany({
    where: { coachProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { post: { include: activeAppCount } },
  });
  const apps = await prisma.coachJobApplication.findMany({
    where: { coachProfileId: profile.id, postId: { in: rows.map((r) => r.postId) }, status: { not: 'WITHDRAWN' } },
    select: { postId: true },
  });
  const appliedSet = new Set(apps.map((a) => a.postId));
  const clubMap = await clubNames(rows.map((r) => r.post.clubId));
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    post: toCard(r.post, clubMap),
    applied: appliedSet.has(r.postId),
  }));
}

/** 제안 거절(코치 본인). */
export async function declineInvite(inviteId: string, userId: string): Promise<void> {
  const invite = await prisma.coachJobInvite.findUnique({
    where: { id: inviteId },
    include: { coachProfile: { select: { userId: true } } },
  });
  if (!invite) throw new NotFoundError('제안');
  if (invite.coachProfile.userId !== userId) throw new ForbiddenError();
  await prisma.coachJobInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED' } });
}

// ─── 원문 공고 스크랩 ─────────────────────────────────────────
// 학교·체육센터 홈페이지의 채용 게시글 URL을 붙여넣으면 제목·요약을 가져와
// 공고 작성 폼을 채워준다. 임의 URL fetch 이므로 SSRF 가드(사설망 차단) 필수.

import { lookup as dnsLookup } from 'dns/promises';

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

/** URL 에서 제목·요약 스크랩(OG 태그 우선, 폴백 <title>). */
export async function scrapeJobUrl(rawUrl: unknown): Promise<{ title: string | null; description: string | null }> {
  const urlStr = clamp(rawUrl, 500);
  if (!urlStr) throw new BadRequestError('주소를 입력해 주세요');
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new BadRequestError('올바른 주소가 아니에요 (https://... 형태)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestError('http/https 주소만 가져올 수 있어요');
  }
  // SSRF 가드 — 호스트가 사설망으로 풀리면 거절.
  try {
    const { address } = await dnsLookup(url.hostname);
    if (isPrivateIp(address)) throw new Error('private');
  } catch {
    throw new BadRequestError('이 주소는 가져올 수 없어요');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html = '';
  try {
    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KokgoBot/1.0)' },
    });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    // 최대 512KB 만 읽는다(대용량 방어).
    const reader = resp.body?.getReader();
    if (reader) {
      let received = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        received += value.length;
        if (received > 512 * 1024) { controller.abort(); break; }
      }
      html = Buffer.concat(chunks).toString('utf8');
    } else {
      html = await resp.text();
    }
  } catch {
    throw new BadRequestError('페이지를 불러오지 못했어요 — 주소를 확인해 주세요');
  } finally {
    clearTimeout(timer);
  }

  const pick = (re: RegExp): string | null => {
    const m = html.match(re);
    return m ? decodeEntities(m[1]).slice(0, 300) || null : null;
  };
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ??
    pick(/<title[^>]*>([^<]+)<\/title>/i);
  const description =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  if (!title && !description) {
    throw new BadRequestError('이 페이지에서는 내용을 읽어오지 못했어요 — 직접 입력해 주세요');
  }
  return { title, description };
}

import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

// ─────────────────────────────────────────────────────────────
// 운영 지표 수집(슈퍼관리자 대시보드).
//  - 소급 계산 불가한 값(동시접속 피크·API 요청수)은 프로세스 메모리에 카운트하다가
//    주기적으로 DailyMetric(오늘 행)에 flush(누적). 재시작에도 DB에 누적돼 안전.
//  - DAU·정모·체크인·게임 같은 활동량은 조회 시 기존 타임스탬프로 계산(저장 X).
// 서버는 KST(UTC+9)로 돌아가므로 new Date() 로컬값이 곧 KST. dayKey 는 로컬 기준.
// ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ─── 프로세스 메모리 카운터 ───
let peakToday = 0; // 오늘 관측한 최대 동시접속
let requestDelta = 0; // 마지막 flush 이후 쌓인 요청 수
let bucketKey = dayKeyOf(new Date()); // 위 카운터가 속한 날
// '누가 접속 중'인지 — 소켓이 user:join 하면 userId 와 연결해 둔다(대시보드 드릴다운).
const socketUser = new Map<string, string>(); // socketId → userId

// 실시간 접속 수는 '수동 카운터' 대신 Socket.IO 의 실제 연결 수(engine.clientsCount)를
// 권위값으로 쓴다. 수동 카운터는 유령 연결(disconnect 누락)로 시간이 지나며 드리프트했다.
// socket 모듈이 초기화 때 registerIO(io) 로 인스턴스를 넘겨준다(순환 import 회피).
let ioRef: { engine?: { clientsCount?: number } } | null = null;
export function registerIO(io: { engine?: { clientsCount?: number } }): void {
  ioRef = io;
}
function liveConnections(): number {
  const n = ioRef?.engine?.clientsCount;
  return typeof n === 'number' && n >= 0 ? n : 0;
}

export function noteRequest(): void {
  requestDelta += 1;
}
export function noteConnect(): void {
  const n = liveConnections();
  if (n > peakToday) peakToday = n;
}
export function noteDisconnect(socketId?: string): void {
  if (socketId) socketUser.delete(socketId);
}
// 소켓이 자기 userId 를 알린 시점(인증 후 user:join)에 연결.
export function noteSocketUser(socketId: string, userId: string): void {
  if (!userId) return;
  socketUser.set(socketId, userId);
}

// 오늘 앱에 접근(로그인/인증 API 요청)한 순 userId → 마지막 접근 ms. 체크인 안 해도 잡힌다.
// 프로세스 메모리(서버 재시작 시 그날치 리셋) — DB 컬럼 추가 없이 '오늘 접속 회원' 파악용.
let seenToday = new Map<string, number>();
let seenTodayKey = dayKeyOf(new Date());
function rolloverSeen(): void {
  const k = dayKeyOf(new Date());
  if (k !== seenTodayKey) {
    seenTodayKey = k;
    seenToday = new Map();
  }
}
export function noteSeen(userId: string): void {
  if (!userId) return;
  rolloverSeen();
  seenToday.set(userId, Date.now());
}
export function getSeenToday(): { userId: string; at: number }[] {
  rolloverSeen();
  return Array.from(seenToday, ([userId, at]) => ({ userId, at }));
}
export function getCurrentConnections(): number {
  return liveConnections();
}
// 지금 접속 중인 순 userId — user:join 한 소켓들 중, 실제로 아직 연결된 소켓만 반영하도록
// (드리프트 방지) socketUser 를 그대로 쓰되 disconnect 에서 정리한다.
function onlineUserIdsInternal(): string[] {
  return Array.from(new Set(socketUser.values()));
}
export function getOnlineUserIds(): string[] {
  return onlineUserIdsInternal();
}

// 오늘 행에 누적 반영(요청수는 증가분 increment, 피크는 max). 날이 바뀌었으면
// 이전 날에 마지막 flush 후 새 날로 롤오버.
async function upsertDay(dateKey: string, addRequests: number, peak: number): Promise<void> {
  const existing = await prisma.dailyMetric.findUnique({ where: { date: dateKey } });
  if (existing) {
    await prisma.dailyMetric.update({
      where: { date: dateKey },
      data: {
        requestCount: { increment: addRequests },
        peakConnections: Math.max(existing.peakConnections, peak),
      },
    });
  } else {
    await prisma.dailyMetric.create({
      data: { date: dateKey, requestCount: addRequests, peakConnections: peak },
    });
  }
}

let flushing = false;
export async function flushMetrics(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const nowKey = dayKeyOf(new Date());
    const addRequests = requestDelta;
    requestDelta = 0;
    // flush 때마다 현재 실제 연결 수로 오늘 피크를 갱신(관측 샘플).
    if (liveConnections() > peakToday) peakToday = liveConnections();
    await upsertDay(bucketKey, addRequests, peakToday);
    if (nowKey !== bucketKey) {
      // 날 넘어감 → 새 날 시작. 현재 연결 수를 새 날의 시작 피크로.
      bucketKey = nowKey;
      peakToday = liveConnections();
      // 새 날 행을 즉시 만들어 오늘 피크가 곧바로 반영되게.
      await upsertDay(bucketKey, 0, peakToday);
    }
  } catch (err) {
    logger.warn(`metrics flush 실패(무시): ${(err as Error).message}`);
  } finally {
    flushing = false;
  }
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
export function initMetrics(): void {
  bucketKey = dayKeyOf(new Date());
  // 60초마다 flush(요청수 누적 + 피크 반영 + 날 롤오버).
  flushTimer = setInterval(() => { void flushMetrics(); }, 60_000);
  logger.info('Metrics collector started (flush every 60s)');
}
export function stopMetrics(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

// ─── 대시보드 조회 ───
export type Granularity = 'day' | 'week' | 'month';

export interface MetricPoint {
  key: string; // 버킷 키(day: YYYY-MM-DD, week: 시작일 YYYY-MM-DD, month: YYYY-MM)
  label: string; // 화면 표시용 짧은 라벨
  dau: number; // 그 기간에 체크인한 순 사용자 수
  newUsers: number; // 그 기간 신규 가입(회원, 게스트 제외)
  cumulativeMembers: number; // 그 기간 말 기준 누적 회원 수(성장 추세)
  checkins: number; // 그 기간 체크인 건수
  sessions: number; // 그 기간 시작된 정모 수
  games: number; // 그 기간 완료된 게임(턴) 수
  peakConnections: number; // 그 기간 최대 동시접속(일별 피크의 max)
  requestCount: number; // 그 기간 API 요청수(일별 합)
}

export interface AdminMetricsResponse {
  live: {
    currentConnections: number;
    todayPeakConnections: number;
    todayRequests: number;
    todayDau: number;
    todayActive: number; // 오늘 앱에 접근(로그인/요청)한 순 회원 — 체크인 무관
    activeSessions: number; // 지금 진행 중(ACTIVE)인 정모 수
    checkedInNow: number; // 지금 체크인(미퇴장) 인원
  };
  totals: {
    members: number; // 진짜 가입 회원 — 로그인 수단(비번/카카오/구글) 있는 계정
    managed: number; // 명단·기타 — 로그인 수단 없는 비게스트(운영자 명단추가 + 시드 placeholder)
    guests: number; // 누적 게스트 레코드
    clubs: number;
    facilities: number;
  };
  granularity: Granularity;
  series: MetricPoint[]; // 오래된→최신 순
  hourly: number[]; // 시간대별(0~23시) 체크인 수 — 조회 구간 기준(피크타임)
}

// 기간 버킷(일/주/월) 생성 — 모두 '날 경계(자정)'에 정렬돼, 각 날짜를 버킷 인덱스로
// 매핑할 수 있다(주=월요일 시작 7일, 월=달력 월).
interface Bucket { key: string; label: string; start: Date; end: Date }
function buildBuckets(granularity: Granularity, count: number, now: Date): Bucket[] {
  const out: Bucket[] = [];
  if (granularity === 'month') {
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      out.push({ key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`, label: `${String(start.getFullYear()).slice(2)}.${start.getMonth() + 1}`, start, end });
    }
  } else if (granularity === 'week') {
    // 이번 주 월요일 기준으로 i주 전.
    const dow = now.getDay(); // 0=일..6=토
    const toMon = dow === 0 ? -6 : 1 - dow;
    const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMon);
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7 * i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      out.push({ key: dayKeyOf(start), label: `${start.getMonth() + 1}/${start.getDate()}`, start, end });
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      out.push({ key: dayKeyOf(start), label: `${start.getMonth() + 1}/${start.getDate()}`, start, end });
    }
  }
  return out;
}

const DEFAULT_COUNT: Record<Granularity, number> = { day: 14, week: 12, month: 6 };

// '가입 회원' = 실제 앱 사용자. 카카오·구글 소셜 로그인은 모두 회원으로 센다.
// 전화(비밀번호) 계정은 대부분 운영/테스트용이라, 관리자 역할(최고관리자·시설관리자·
// 모임리더)만 회원으로 인정하고 일반(PLAYER) 전화 계정은 제외한다. 게스트·명단추가 제외.
const SIGNED_UP: Prisma.UserWhereInput = {
  isGuest: false,
  isManaged: false,
  OR: [
    { kakaoId: { not: null } },
    { googleId: { not: null } },
    { AND: [{ password: { not: null } }, { role: { in: ['SUPER_ADMIN', 'FACILITY_ADMIN', 'CLUB_LEADER'] } }] },
  ],
};

export async function getAdminMetrics(granularity: Granularity = 'day', count?: number): Promise<AdminMetricsResponse> {
  const now = new Date();
  const n = Math.min(Math.max(count ?? DEFAULT_COUNT[granularity], 1), granularity === 'day' ? 60 : granularity === 'week' ? 26 : 24);
  const buckets = buildBuckets(granularity, n, now);
  const windowStart = buckets[0].start;

  // 각 '날'(YYYY-MM-DD) → 버킷 인덱스 매핑(모든 경계가 날 정렬이라 가능).
  const dayToIdx = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) {
    for (let d = new Date(buckets[i].start); d < buckets[i].end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      dayToIdx.set(dayKeyOf(d), i);
    }
  }
  const idxOf = (ts: Date): number | undefined => dayToIdx.get(dayKeyOf(ts));

  // 로그인 수단 없는 비게스트(운영자 명단추가 + 시드/기타 placeholder).
  const NO_LOGIN: Prisma.UserWhereInput = { isGuest: false, password: null, kakaoId: null, googleId: null };

  const [users, checkins, sessions, turns, metricRows, totalMembers, totalGuests, totalClubs, totalFacilities, activeSessions, checkedInNow, totalManaged] =
    await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: windowStart }, ...SIGNED_UP }, select: { createdAt: true } }),
      prisma.checkIn.findMany({ where: { checkedInAt: { gte: windowStart } }, select: { userId: true, checkedInAt: true } }),
      prisma.clubSession.findMany({ where: { startedAt: { gte: windowStart } }, select: { startedAt: true } }),
      prisma.courtTurn.findMany({ where: { completedAt: { gte: windowStart } }, select: { completedAt: true } }),
      prisma.dailyMetric.findMany({ where: { date: { gte: dayKeyOf(windowStart) } } }),
      prisma.user.count({ where: SIGNED_UP }), // 진짜 가입 회원(로그인 수단 있음)
      prisma.user.count({ where: { isGuest: true } }),
      prisma.club.count(),
      prisma.facility.count(),
      prisma.clubSession.count({ where: { status: 'ACTIVE' } }),
      // '지금 체크인' = 진행 중(ACTIVE)인 정모에 체크인한(미퇴장) 인원만. 종료된/버려진
      // 세션의 잔여 체크인이나 정모 미연결 체크인은 제외(예전엔 전체를 세어 부풀려졌음).
      prisma.checkIn.count({ where: { checkedOutAt: null, clubSession: { status: 'ACTIVE' } } }),
      prisma.user.count({ where: NO_LOGIN }), // 명단·기타(로그인 없는 비게스트)
    ]);

  // 시간대별(0~23시) 체크인 분포 — 조회 구간 기준 피크타임.
  const hourly = new Array(24).fill(0) as number[];
  for (const c of checkins) hourly[c.checkedInAt.getHours()] += 1;

  const series: MetricPoint[] = buckets.map((b) => ({ key: b.key, label: b.label, dau: 0, newUsers: 0, cumulativeMembers: 0, checkins: 0, sessions: 0, games: 0, peakConnections: 0, requestCount: 0 }));
  const dauSets = buckets.map(() => new Set<string>());

  for (const u of users) { const i = idxOf(u.createdAt); if (i !== undefined) series[i].newUsers += 1; }
  for (const c of checkins) { const i = idxOf(c.checkedInAt); if (i !== undefined) { series[i].checkins += 1; dauSets[i].add(c.userId); } }
  for (const s of sessions) { const i = idxOf(s.startedAt); if (i !== undefined) series[i].sessions += 1; }
  for (const t of turns) { if (!t.completedAt) continue; const i = idxOf(t.completedAt); if (i !== undefined) series[i].games += 1; }
  for (let i = 0; i < series.length; i++) series[i].dau = dauSets[i].size;
  // DailyMetric(일별 기록) → 기간 집계: 요청수 합, 피크 max.
  for (const m of metricRows) {
    const i = dayToIdx.get(m.date);
    if (i !== undefined) {
      series[i].requestCount += m.requestCount;
      series[i].peakConnections = Math.max(series[i].peakConnections, m.peakConnections);
    }
  }

  // 회원 성장(누적): windowStart 이전 회원 baseline + 기간별 신규 누적 → 각 기간 말 누적 회원.
  const newInWindow = series.reduce((a, s) => a + s.newUsers, 0);
  let running = Math.max(0, totalMembers - newInWindow);
  for (const s of series) { running += s.newUsers; s.cumulativeMembers = running; }

  // 현재 기간(마지막 버킷) 막대에 아직 flush 안 된 오늘 요청/피크를 반영.
  const liveConn = liveConnections();
  const last = series[series.length - 1];
  if (last) {
    last.requestCount += requestDelta;
    last.peakConnections = Math.max(last.peakConnections, peakToday, liveConn);
  }

  // 실시간/오늘 카드는 granularity 와 무관하게 항상 '오늘' 기준으로 계산.
  const todayKey = dayKeyOf(now);
  const todayMetric = metricRows.find((m) => m.date === todayKey);
  const todaySet = new Set<string>();
  for (const c of checkins) if (dayKeyOf(c.checkedInAt) === todayKey) todaySet.add(c.userId);

  return {
    live: {
      currentConnections: liveConn,
      todayPeakConnections: Math.max(todayMetric?.peakConnections ?? 0, peakToday, liveConn),
      todayRequests: (todayMetric?.requestCount ?? 0) + requestDelta,
      todayDau: todaySet.size,
      todayActive: getSeenToday().length,
      activeSessions,
      checkedInNow,
    },
    totals: { members: totalMembers, managed: totalManaged, guests: totalGuests, clubs: totalClubs, facilities: totalFacilities },
    granularity,
    series,
    hourly,
  };
}

// ─── 드릴다운: '누구'인지 명단 ───
export type WhoScope = 'online' | 'checkedin' | 'today' | 'signups' | 'accessed';
export interface WhoUser {
  userId: string;
  name: string;
  isGuest: boolean;
  context?: string; // 체크인: 모임/시설 · 가입: 로그인수단(카카오/구글/전화)
  at?: string; // 체크인/가입 시각(ISO)
}
export interface WhoResponse {
  scope: WhoScope;
  count: number;
  users: WhoUser[];
}

export async function getMetricsWho(scope: WhoScope, fromISO?: string, toISO?: string): Promise<WhoResponse> {
  if (scope === 'signups') {
    // 가입 회원(SIGNED_UP) 명단 — 누가 언제 어떤 수단으로 가입했는지. from/to 있으면 그 구간만.
    const from = fromISO ? new Date(fromISO) : undefined;
    const to = toISO ? new Date(toISO) : undefined;
    const rows = await prisma.user.findMany({
      where: {
        ...SIGNED_UP,
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, name: true, createdAt: true, kakaoId: true, googleId: true, password: true, role: true },
    });
    const method = (u: { kakaoId: string | null; googleId: string | null }) =>
      u.kakaoId ? '카카오' : u.googleId ? '구글' : '전화(관리자)';
    return {
      scope,
      count: rows.length,
      users: rows.map((u) => ({ userId: u.id, name: u.name, isGuest: false, context: method(u), at: u.createdAt.toISOString() })),
    };
  }

  if (scope === 'online') {
    const ids = getOnlineUserIds();
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isGuest: true } })
      : [];
    return { scope, count: users.length, users: users.map((u) => ({ userId: u.id, name: u.name, isGuest: u.isGuest })) };
  }

  if (scope === 'accessed') {
    // 오늘 앱에 접근(로그인/요청)한 회원 명단 — 체크인 안 해도 잡힘. 인메모리 기준(재시작 후분).
    const seen = getSeenToday();
    const atById = new Map(seen.map((s) => [s.userId, s.at]));
    const users = seen.length
      ? await prisma.user.findMany({ where: { id: { in: seen.map((s) => s.userId) } }, select: { id: true, name: true, isGuest: true } })
      : [];
    return {
      scope,
      count: users.length,
      users: users
        .map((u) => ({ userId: u.id, name: u.name, isGuest: u.isGuest, at: new Date(atById.get(u.id) ?? Date.now()).toISOString() }))
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  }

  // checkedin = 지금 체크인(미퇴장), today = 오늘 체크인한 순 사용자
  const where = scope === 'checkedin'
    ? { checkedOutAt: null }
    : { checkedInAt: { gte: startOfDayKey(dayKeyOf(new Date())) } };
  const rows = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    select: {
      userId: true,
      checkedInAt: true,
      user: { select: { name: true, isGuest: true } },
      facility: { select: { name: true } },
      clubSession: { select: { title: true, club: { select: { name: true } } } },
    },
  });
  // today 는 순 사용자로 dedup(가장 최근 체크인 기준).
  const seen = new Set<string>();
  const users: WhoUser[] = [];
  for (const r of rows) {
    if (scope === 'today') {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
    }
    const ctx = r.clubSession?.club?.name ?? r.facility?.name ?? undefined;
    users.push({ userId: r.userId, name: r.user.name, isGuest: r.user.isGuest, context: ctx, at: r.checkedInAt.toISOString() });
  }
  return { scope, count: users.length, users };
}

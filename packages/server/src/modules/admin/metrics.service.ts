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
let currentConnections = 0; // 지금 연결된 소켓 수(실시간)
let peakToday = 0; // 오늘 관측한 최대 동시접속
let requestDelta = 0; // 마지막 flush 이후 쌓인 요청 수
let bucketKey = dayKeyOf(new Date()); // 위 카운터가 속한 날
// '누가 접속 중'인지 — 소켓이 user:join 하면 userId 와 연결해 둔다(대시보드 드릴다운).
const socketUser = new Map<string, string>(); // socketId → userId
const userSockets = new Map<string, number>(); // userId → 연결 소켓 수

export function noteRequest(): void {
  requestDelta += 1;
}
export function noteConnect(): void {
  currentConnections += 1;
  if (currentConnections > peakToday) peakToday = currentConnections;
}
export function noteDisconnect(socketId?: string): void {
  currentConnections = Math.max(0, currentConnections - 1);
  if (socketId) {
    const uid = socketUser.get(socketId);
    if (uid) {
      socketUser.delete(socketId);
      const c = (userSockets.get(uid) ?? 1) - 1;
      if (c <= 0) userSockets.delete(uid);
      else userSockets.set(uid, c);
    }
  }
}
// 소켓이 자기 userId 를 알린 시점(인증 후 user:join)에 연결.
export function noteSocketUser(socketId: string, userId: string): void {
  if (!userId || socketUser.get(socketId) === userId) return;
  socketUser.set(socketId, userId);
  userSockets.set(userId, (userSockets.get(userId) ?? 0) + 1);
}
export function getCurrentConnections(): number {
  return currentConnections;
}
export function getOnlineUserIds(): string[] {
  return Array.from(userSockets.keys());
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
    await upsertDay(bucketKey, addRequests, peakToday);
    if (nowKey !== bucketKey) {
      // 날 넘어감 → 새 날 시작. 현재 연결 수를 새 날의 시작 피크로.
      bucketKey = nowKey;
      peakToday = currentConnections;
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
    activeSessions: number; // 지금 진행 중(ACTIVE)인 정모 수
    checkedInNow: number; // 지금 체크인(미퇴장) 인원
  };
  totals: {
    members: number; // 실회원(게스트 제외)
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

  const [users, checkins, sessions, turns, metricRows, totalMembers, totalGuests, totalClubs, totalFacilities, activeSessions, checkedInNow] =
    await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: windowStart }, isGuest: false }, select: { createdAt: true } }),
      prisma.checkIn.findMany({ where: { checkedInAt: { gte: windowStart } }, select: { userId: true, checkedInAt: true } }),
      prisma.clubSession.findMany({ where: { startedAt: { gte: windowStart } }, select: { startedAt: true } }),
      prisma.courtTurn.findMany({ where: { completedAt: { gte: windowStart } }, select: { completedAt: true } }),
      prisma.dailyMetric.findMany({ where: { date: { gte: dayKeyOf(windowStart) } } }),
      prisma.user.count({ where: { isGuest: false } }), // 실회원(게스트 제외)
      prisma.user.count({ where: { isGuest: true } }),
      prisma.club.count(),
      prisma.facility.count(),
      prisma.clubSession.count({ where: { status: 'ACTIVE' } }),
      prisma.checkIn.count({ where: { checkedOutAt: null } }),
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
  const last = series[series.length - 1];
  if (last) {
    last.requestCount += requestDelta;
    last.peakConnections = Math.max(last.peakConnections, peakToday, currentConnections);
  }

  // 실시간/오늘 카드는 granularity 와 무관하게 항상 '오늘' 기준으로 계산.
  const todayKey = dayKeyOf(now);
  const todayMetric = metricRows.find((m) => m.date === todayKey);
  const todaySet = new Set<string>();
  for (const c of checkins) if (dayKeyOf(c.checkedInAt) === todayKey) todaySet.add(c.userId);

  return {
    live: {
      currentConnections,
      todayPeakConnections: Math.max(todayMetric?.peakConnections ?? 0, peakToday, currentConnections),
      todayRequests: (todayMetric?.requestCount ?? 0) + requestDelta,
      todayDau: todaySet.size,
      activeSessions,
      checkedInNow,
    },
    totals: { members: totalMembers, guests: totalGuests, clubs: totalClubs, facilities: totalFacilities },
    granularity,
    series,
    hourly,
  };
}

// ─── 드릴다운: '누구'인지 명단 ───
export type WhoScope = 'online' | 'checkedin' | 'today';
export interface WhoUser {
  userId: string;
  name: string;
  isGuest: boolean;
  context?: string; // 모임/시설 등 맥락(체크인 명단용)
  at?: string; // 체크인 시각(ISO)
}
export interface WhoResponse {
  scope: WhoScope;
  count: number;
  users: WhoUser[];
}

export async function getMetricsWho(scope: WhoScope): Promise<WhoResponse> {
  if (scope === 'online') {
    const ids = getOnlineUserIds();
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isGuest: true } })
      : [];
    return { scope, count: users.length, users: users.map((u) => ({ userId: u.id, name: u.name, isGuest: u.isGuest })) };
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

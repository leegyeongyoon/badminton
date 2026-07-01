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

export function noteRequest(): void {
  requestDelta += 1;
}
export function noteConnect(): void {
  currentConnections += 1;
  if (currentConnections > peakToday) peakToday = currentConnections;
}
export function noteDisconnect(): void {
  currentConnections = Math.max(0, currentConnections - 1);
}
export function getCurrentConnections(): number {
  return currentConnections;
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
export interface DailyMetricRow {
  date: string;
  dau: number; // 그날 체크인한 순 사용자 수
  newUsers: number; // 그날 신규 가입
  checkins: number; // 그날 체크인 건수
  sessions: number; // 그날 시작된 정모 수
  games: number; // 그날 완료된 게임(턴) 수
  peakConnections: number; // 그날 최대 동시접속(기록값)
  requestCount: number; // 그날 API 요청수(기록값)
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
    users: number;
    clubs: number;
    facilities: number;
  };
  daily: DailyMetricRow[]; // 오래된→최신 순
}

export async function getAdminMetrics(days = 14): Promise<AdminMetricsResponse> {
  const span = Math.min(Math.max(days, 1), 90);
  const now = new Date();
  // 최근 span 일의 dayKey(오래된→최신)
  const keys: string[] = [];
  for (let i = span - 1; i >= 0; i--) {
    keys.push(dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  const windowStart = startOfDayKey(keys[0]);

  const [users, checkins, sessions, turns, metricRows, totalUsers, totalClubs, totalFacilities, activeSessions, checkedInNow] =
    await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: windowStart } }, select: { createdAt: true } }),
      prisma.checkIn.findMany({ where: { checkedInAt: { gte: windowStart } }, select: { userId: true, checkedInAt: true } }),
      prisma.clubSession.findMany({ where: { startedAt: { gte: windowStart } }, select: { startedAt: true } }),
      prisma.courtTurn.findMany({ where: { completedAt: { gte: windowStart } }, select: { completedAt: true } }),
      prisma.dailyMetric.findMany({ where: { date: { in: keys } } }),
      prisma.user.count(),
      prisma.club.count(),
      prisma.facility.count(),
      prisma.clubSession.count({ where: { status: 'ACTIVE' } }),
      prisma.checkIn.count({ where: { checkedOutAt: null } }),
    ]);

  // 버킷 초기화
  const bucket = new Map<string, DailyMetricRow>();
  const dauSets = new Map<string, Set<string>>();
  for (const k of keys) {
    bucket.set(k, { date: k, dau: 0, newUsers: 0, checkins: 0, sessions: 0, games: 0, peakConnections: 0, requestCount: 0 });
    dauSets.set(k, new Set<string>());
  }
  for (const u of users) { const b = bucket.get(dayKeyOf(u.createdAt)); if (b) b.newUsers += 1; }
  for (const c of checkins) {
    const k = dayKeyOf(c.checkedInAt);
    const b = bucket.get(k);
    if (b) { b.checkins += 1; dauSets.get(k)!.add(c.userId); }
  }
  for (const s of sessions) { const b = bucket.get(dayKeyOf(s.startedAt)); if (b) b.sessions += 1; }
  for (const t of turns) { if (!t.completedAt) continue; const b = bucket.get(dayKeyOf(t.completedAt)); if (b) b.games += 1; }
  for (const [k, set] of dauSets) { bucket.get(k)!.dau = set.size; }
  for (const m of metricRows) {
    const b = bucket.get(m.date);
    if (b) { b.peakConnections = m.peakConnections; b.requestCount = m.requestCount; }
  }

  const daily = keys.map((k) => bucket.get(k)!);
  const todayKey = keys[keys.length - 1];
  const today = bucket.get(todayKey)!;

  return {
    live: {
      currentConnections,
      // 오늘 피크: 기록값과 메모리 관측값 중 큰 쪽.
      todayPeakConnections: Math.max(today.peakConnections, peakToday, currentConnections),
      // 오늘 요청수: 기록값 + 아직 flush 안 된 증가분.
      todayRequests: today.requestCount + requestDelta,
      todayDau: today.dau,
      activeSessions,
      checkedInNow,
    },
    totals: { users: totalUsers, clubs: totalClubs, facilities: totalFacilities },
    daily,
  };
}

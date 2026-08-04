import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';
import { sendPushToUser } from '../notification/notification.service';
import { startSession, endSession } from './clubSession.service';

// ─────────────────────────────────────────────────────────────
// 정모 자동 개설·자동 종료.
//  · 개설: autoSessionEnabled 클럽의 weeklySchedule 슬롯 시작 N분 전(openMinutes)
//    ~ 종료 시각 사이에 세션이 없으면 리더 명의로 자동 개설 + 멤버 푸시.
//    autoSlotKey("clubId:YYYY-MM-DD:HH:mm") unique 로 슬롯당 1회만(멱등).
//  · 종료: ACTIVE 세션이 시작 후 AUTO_END_HOURS 지나면 자동 종료(방치 방지).
// 시간은 전부 KST(Asia/Seoul) 기준 — 서버가 UTC 여도 동일하게 동작한다.
// ─────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 방치된 ACTIVE 세션 자동 종료 기준(시작 후 경과 시간). */
const AUTO_END_HOURS = 12;

interface WeeklySlot {
  day: number; // 0(일)~6(토)
  start: string; // "HH:mm"
  end: string;
}

function parseSlots(raw: unknown): WeeklySlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is WeeklySlot =>
      s != null &&
      typeof s === 'object' &&
      Number.isInteger((s as WeeklySlot).day) &&
      /^\d{2}:\d{2}$/.test(String((s as WeeklySlot).start)) &&
      /^\d{2}:\d{2}$/.test(String((s as WeeklySlot).end)),
  );
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 자동 개설·종료 1회 실행. 반환값은 데모/E2E 검증용 카운트. */
export async function runAutoSessionTick(): Promise<{ opened: number; ended: number; skipped: number }> {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  const nowMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const dateKey = kst.toISOString().slice(0, 10);

  let opened = 0;
  let skipped = 0;

  const clubs = await prisma.club.findMany({
    where: { autoSessionEnabled: true },
    select: {
      id: true,
      name: true,
      homeFacilityId: true,
      weeklySchedule: true,
      autoSessionOpenMinutes: true,
      autoSessionCourtCount: true,
    },
  });

  for (const club of clubs) {
    const slot = parseSlots(club.weeklySchedule).find((s) => {
      if (s.day !== day) return false;
      const start = toMin(s.start);
      const end = toMin(s.end);
      if (end <= start) return false; // 자정 넘김 슬롯은 미지원
      return nowMin >= start - club.autoSessionOpenMinutes && nowMin < end;
    });
    if (!slot) continue;
    if (!club.homeFacilityId) {
      skipped++;
      continue; // 홈 시설이 없으면 열 수 없음(운영 정보에서 설정 필요)
    }

    const slotKey = `${club.id}:${dateKey}:${slot.start}`;
    const already = await prisma.clubSession.findUnique({ where: { autoSlotKey: slotKey } });
    if (already) continue;

    const leader = await prisma.clubMember.findFirst({
      where: { clubId: club.id, role: 'LEADER' },
      select: { userId: true },
    });
    if (!leader) {
      skipped++;
      continue;
    }

    try {
      // 리더 명의로 기존 startSession 재사용(코트 생성·소켓·멤버 푸시 포함).
      const session = await startSession(club.id, leader.userId, {
        facilityId: club.homeFacilityId,
        courtCount: club.autoSessionCourtCount,
      });
      await prisma.clubSession.update({ where: { id: session.id }, data: { autoSlotKey: slotKey } });
      opened++;
      // startSession 은 스타터(리더)에게 푸시를 보내지 않으므로 리더에겐 운영 알림을 따로.
      try {
        await sendPushToUser(leader.userId, {
          title: '정모 자동 개설',
          body: `${club.name} ${slot.start} 정모가 자동으로 열렸어요 — 운영판에서 확인하세요`,
          data: { type: 'session_started', clubSessionId: session.id },
        });
      } catch { /* 푸시 실패는 무시 */ }
      logger.info('autoSession.opened', { clubId: club.id, slotKey, sessionId: session.id });
    } catch (err) {
      // 이미 진행 중 정모(수동 개설) 등 — 다음 틱에 재시도하지 않도록 로그만.
      skipped++;
      logger.warn('autoSession.open_failed', { clubId: club.id, slotKey, error: String(err) });
    }
  }

  // ── 방치된 ACTIVE 세션 자동 종료 ──
  let ended = 0;
  const stale = await prisma.clubSession.findMany({
    where: { status: 'ACTIVE', startedAt: { lt: new Date(Date.now() - AUTO_END_HOURS * 3600_000) } },
    select: { id: true, clubId: true },
  });
  for (const s of stale) {
    const leader = await prisma.clubMember.findFirst({
      where: { clubId: s.clubId, role: 'LEADER' },
      select: { userId: true },
    });
    if (!leader) continue;
    try {
      await endSession(s.id, leader.userId);
      ended++;
      logger.info('autoSession.auto_ended', { sessionId: s.id });
    } catch (err) {
      logger.warn('autoSession.end_failed', { sessionId: s.id, error: String(err) });
    }
  }

  return { opened, ended, skipped };
}

/** 서버 기동 시 1분 주기 자동 개설·종료 루프. */
export function startAutoSessionLoop(): void {
  const run = () =>
    runAutoSessionTick().catch((err) => logger.error('autoSession.tick_failed', { error: String(err) }));
  setTimeout(run, 15_000); // 기동 직후 1회(다른 초기화 뒤)
  setInterval(run, 60_000);
  logger.info('autoSession loop started (60s tick)');
}

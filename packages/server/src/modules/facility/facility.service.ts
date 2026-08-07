import { prisma } from '../../utils/prisma';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { CourtGameType } from '@badminton/shared';
import type { CreateFacilityInput, UpdatePolicyInput, UpdateCoordinatesInput, DisplayBoardResponse, BoardCourtData, ClubSessionInfo } from '@badminton/shared';
import { getPlayersRequired } from '../court/court.service';
import QRCode from 'qrcode';

// 카카오 로컬 '키워드 장소검색' 프록시. REST 키를 서버에 두고(클라 노출·웹 CORS 회피)
// "OO배드민턴/체육관" 검색 → 이름·주소·좌표를 돌려준다. 키 없거나 실패 시 빈 배열(안전).
export interface PlaceSearchResult {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const q = (query || '').trim();
  if (!q) return [];
  const key = process.env.KAKAO_REST_KEY || '';
  if (!key) {
    logger.warn('searchPlaces 스킵 — KAKAO_REST_KEY 미설정');
    return [];
  }
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=15`;
  try {
    // 이 키는 카카오 JS(지도) 키라, Local API 는 JS SDK 처럼 KA 헤더(os/javascript + 등록된
    // 웹 도메인 origin)를 요구한다. origin 은 카카오 앱에 등록된 badmintoncourt.store(지도가
    // 이미 여기서 동작). 이거 없으면 401 "KA Header is required".
    const res = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${key}`,
        KA: 'sdk/1.43.0 os/javascript lang/ko-KR device/server origin/https%3A%2F%2Fbadmintoncourt.store',
      },
    });
    if (!res.ok) {
      logger.error('카카오 장소검색 실패(HTTP)', { status: res.status });
      return [];
    }
    const json: any = await res.json();
    const docs: any[] = Array.isArray(json?.documents) ? json.documents : [];
    return docs
      .map((d) => ({
        name: String(d.place_name ?? ''),
        address: String(d.road_address_name || d.address_name || ''),
        latitude: Number(d.y),
        longitude: Number(d.x),
      }))
      .filter((p) => p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  } catch (err) {
    logger.error('카카오 장소검색 예외', { err });
    return [];
  }
}

export async function createFacility(userId: string, input: CreateFacilityInput) {
  // 좌표/주소는 선택. 이름만으로 만들 수 있고(좌표 null), 나중에 GPS 핀을 찍는다.
  const facility = await prisma.facility.create({
    data: {
      name: input.name,
      // address 는 non-nullable. 이름만 추가하는 경우 빈 문자열로 둔다(좌표는 nullable).
      address: input.address ?? '',
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      admins: { create: { userId } },
      policy: { create: {} },
    },
    include: { courts: true, policy: true },
  });

  if (input.totalCourts) {
    for (let i = 1; i <= input.totalCourts; i++) {
      await prisma.court.create({
        data: { name: `코트 ${i}`, facilityId: facility.id },
      });
    }
  }

  const created = await prisma.facility.findUnique({
    where: { id: facility.id },
    include: { courts: { where: { clubSessionId: null } } },
  });

  return created;
}

export async function listFacilities() {
  const facilities = await prisma.facility.findMany({
    include: {
      // Facility-admin dashboard: facility-level courts only (정모 courts excluded).
      courts: { where: { clubSessionId: null } },
      sessions: {
        where: { status: 'OPEN' },
        take: 1,
      },
      checkIns: {
        where: { checkedOutAt: null },
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return facilities.map((f) => ({
    id: f.id,
    name: f.name,
    address: f.address,
    latitude: f.latitude,
    longitude: f.longitude,
    qrCodeData: f.qrCodeData,
    courts: f.courts,
    createdAt: f.createdAt.toISOString(),
    courtCount: f.courts.length,
    hasOpenSession: f.sessions.length > 0,
    checkedInCount: f.checkIns.length,
  }));
}

export async function getFacility(id: string) {
  const facility = await prisma.facility.findUnique({
    where: { id },
    include: { courts: { where: { clubSessionId: null }, orderBy: { name: 'asc' } } },
  });
  if (!facility) throw new NotFoundError('시설');
  return facility;
}

export async function getQrCode(id: string) {
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) throw new NotFoundError('시설');
  return QRCode.toDataURL(facility.qrCodeData);
}

export async function getPolicy(facilityId: string) {
  const policy = await prisma.facilityPolicy.findUnique({ where: { facilityId } });
  if (!policy) throw new NotFoundError('시설 정책');
  return policy;
}

export async function updatePolicy(facilityId: string, userId: string, input: UpdatePolicyInput) {
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('시설 관리자만 정책을 수정할 수 있습니다');

  return prisma.facilityPolicy.update({
    where: { facilityId },
    data: input,
  });
}

export async function updateCoordinates(facilityId: string, userId: string, input: UpdateCoordinatesInput) {
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('시설 관리자만 좌표를 수정할 수 있습니다');

  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new NotFoundError('시설');

  return prisma.facility.update({
    where: { id: facilityId },
    data: {
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
}

export async function getBoard(facilityId: string): Promise<BoardCourtData[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      policy: true,
      courts: {
        where: { clubSessionId: null },
        orderBy: { name: 'asc' },
        include: {
          turns: {
            where: { status: { in: ['WAITING', 'PLAYING'] } },
            orderBy: { position: 'asc' },
            include: {
              players: { include: { user: true } },
              createdBy: true,
              game: { include: { players: { include: { user: true } } } },
              clubSession: { include: { club: true } },
            },
          },
        },
      },
    },
  });
  if (!facility) throw new NotFoundError('시설');

  // Load active club sessions for this facility to check court assignments
  const activeClubSessions = await prisma.clubSession.findMany({
    where: { facilityId, status: 'ACTIVE' },
    include: { club: true },
  });

  const maxTurns = facility.policy?.maxTurnsPerCourt ?? 3;

  return facility.courts.map((court) => {
    // Determine clubSessionInfo: check if court is in any active ClubSession.courtIds
    let clubSessionInfo: ClubSessionInfo | null = null;
    for (const cs of activeClubSessions) {
      if (cs.courtIds.includes(court.id)) {
        clubSessionInfo = {
          clubSessionId: cs.id,
          clubId: cs.clubId,
          clubName: cs.club.name,
        };
        break;
      }
    }

    return {
      court: {
        id: court.id,
        name: court.name,
        facilityId: court.facilityId,
        status: court.status as any,
        gameType: court.gameType as any,
        playersRequired: getPlayersRequired(court.gameType as CourtGameType),
      },
      turns: court.turns.map((turn) => ({
        id: turn.id,
        courtId: turn.courtId,
        position: turn.position,
        status: turn.status as any,
        gameType: turn.gameType as any,
        createdById: turn.createdById,
        createdByName: turn.createdBy.name,
        players: turn.players.map((p) => ({
          id: p.id,
          userId: p.userId,
          userName: p.user.name,
        })),
        game: turn.game
          ? {
              id: turn.game.id,
              turnId: turn.game.turnId,
              courtId: turn.game.courtId,
              status: turn.game.status as any,
              players: turn.game.players.map((p) => ({
                id: p.id,
                userId: p.userId,
                userName: p.user.name,
              })),
              createdAt: turn.game.createdAt.toISOString(),
            }
          : null,
        clubSessionId: turn.clubSessionId ?? null,
        clubName: (turn as any).clubSession?.club?.name ?? null,
        createdAt: turn.createdAt.toISOString(),
        startedAt: turn.startedAt?.toISOString() ?? null,
        completedAt: turn.completedAt?.toISOString() ?? null,
        timeLimitAt: turn.timeLimitAt?.toISOString() ?? null,
      })),
      maxTurns,
      clubSessionInfo,
    };
  });
}

export async function getDisplayBoard(facilityId: string): Promise<DisplayBoardResponse> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      policy: true,
      courts: {
        where: { clubSessionId: null },
        orderBy: { name: 'asc' },
        include: {
          turns: {
            where: { status: { in: ['WAITING', 'PLAYING'] } },
            orderBy: { position: 'asc' },
            include: {
              players: { include: { user: true } },
            },
          },
        },
      },
      sessions: {
        where: { status: 'OPEN' },
        take: 1,
        orderBy: { openedAt: 'desc' },
      },
    },
  });
  if (!facility) throw new NotFoundError('시설');

  const currentSession = facility.sessions[0] || null;
  const maxTurns = facility.policy?.maxTurnsPerCourt ?? 3;

  const courts = facility.courts.map((court) => {
    const playingTurn = court.turns.find((t) => t.status === 'PLAYING');

    return {
      courtName: court.name,
      status: court.status as any,
      currentPlayers: playingTurn
        ? playingTurn.players.map((p) => p.user.name)
        : [],
      turnsCount: court.turns.length,
      maxTurns,
      timeLimitAt: playingTurn?.timeLimitAt?.toISOString() ?? null,
      turnPreviews: court.turns.map((t) => ({
        position: t.position,
        players: t.players.map((p) => p.user.name),
        status: t.status as any,
      })),
    };
  });

  return {
    facilityName: facility.name,
    sessionStatus: currentSession?.status as any ?? null,
    courts,
    updatedAt: new Date().toISOString(),
  };
}

export async function getTodayStats(facilityId: string) {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { courts: { select: { id: true } } },
  });
  if (!facility) throw new NotFoundError('시설');

  const courtIds = facility.courts.map((c) => c.id);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Count completed games today
  const totalGames = await prisma.game.count({
    where: {
      courtId: { in: courtIds },
      status: 'COMPLETED',
      createdAt: { gte: startOfDay },
    },
  });

  // Average wait time from courtTurn records (startedAt - createdAt)
  const turnsWithWait = await prisma.courtTurn.findMany({
    where: {
      courtId: { in: courtIds },
      startedAt: { not: null, gte: startOfDay },
    },
    select: { createdAt: true, startedAt: true },
  });

  let avgWaitMinutes = 0;
  if (turnsWithWait.length > 0) {
    const totalWaitMs = turnsWithWait.reduce((sum, t) => {
      return sum + (t.startedAt!.getTime() - t.createdAt.getTime());
    }, 0);
    avgWaitMinutes = Math.round(totalWaitMs / turnsWithWait.length / 60000);
  }

  // Peak players: use current totalCheckedIn as a proxy
  const peakPlayers = await prisma.checkIn.count({
    where: {
      facilityId,
      checkedInAt: { gte: startOfDay },
    },
  });

  return { totalGames, avgWaitMinutes, peakPlayers };
}

export async function getWeeklyTrends(facilityId: string): Promise<{ day: string; count: number }[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { courts: { select: { id: true } } },
  });
  if (!facility) throw new NotFoundError('시설');

  const courtIds = facility.courts.map((c) => c.id);
  const now = new Date();
  const results: { day: string; count: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const count = await prisma.game.count({
      where: {
        courtId: { in: courtIds },
        status: 'COMPLETED',
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    results.push({ day: dayLabel, count });
  }

  return results;
}

export async function getPeakHours(facilityId: string): Promise<{
  hours: string[];
  days: string[];
  data: number[][];
}> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { courts: { select: { id: true } } },
  });
  if (!facility) throw new NotFoundError('시설');

  const courtIds = facility.courts.map((c) => c.id);

  // Get all completed games from the last 4 weeks
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const games = await prisma.game.findMany({
    where: {
      courtId: { in: courtIds },
      status: 'COMPLETED',
      createdAt: { gte: fourWeeksAgo },
    },
    select: { createdAt: true },
  });

  const hours = ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'];
  const days = ['월', '화', '수', '목', '금', '토', '일'];

  // Initialize grid: hours.length rows x days.length cols
  const data: number[][] = hours.map(() => days.map(() => 0));

  for (const game of games) {
    const d = game.createdAt;
    const hour = d.getHours().toString().padStart(2, '0');
    const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon...
    const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0, Sun=6
    const hourIndex = hours.indexOf(hour);

    if (hourIndex >= 0 && dayIndex >= 0 && dayIndex < 7) {
      data[hourIndex][dayIndex]++;
    }
  }

  return { hours, days, data };
}

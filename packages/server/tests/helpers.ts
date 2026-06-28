/**
 * Test helpers: build the minimal, deterministic fixtures each integration
 * suite needs, directly via Prisma against the isolated badminton_test DB.
 *
 * Every record uses a per-call unique suffix so suites/tests never collide and
 * a re-run on a non-empty DB stays green. Helpers return plain ids/objects the
 * tests assert against.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

let counter = 0;
/** Monotonic-ish unique token (process pid + time + counter) for this run. */
export function uniq(): string {
  counter += 1;
  return `${process.pid}${Date.now().toString().slice(-6)}${counter}`;
}

/** A valid Korean phone (01 + 8~9 digits) derived from a unique token. */
export function uniquePhone(): string {
  // 010 + 8 digits. Keep it within the 01[0-9]{8,9} regex.
  const digits = (Date.now().toString() + (counter++).toString()).slice(-8);
  return `010${digits}`.slice(0, 11);
}

export const TEST_PASSWORD = 'password123';

export async function hash(pw: string): Promise<string> {
  return bcrypt.hash(pw, 4); // low cost rounds = faster tests
}

export interface CreatedUser {
  id: string;
  phone: string;
  name: string;
  role: 'PLAYER' | 'CLUB_LEADER' | 'FACILITY_ADMIN';
}

export async function createUser(opts: {
  name?: string;
  role?: 'PLAYER' | 'CLUB_LEADER' | 'FACILITY_ADMIN';
  skillLevel?: 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  gender?: 'M' | 'F';
  password?: string;
} = {}): Promise<CreatedUser> {
  const phone = uniquePhone();
  const user = await prisma.user.create({
    data: {
      phone,
      password: await hash(opts.password ?? TEST_PASSWORD),
      name: opts.name ?? `u${uniq()}`,
      role: opts.role ?? 'PLAYER',
      profile:
        opts.skillLevel || opts.gender
          ? { create: { skillLevel: opts.skillLevel ?? 'D', gender: opts.gender ?? null } }
          : undefined,
    },
  });
  return { id: user.id, phone: user.phone!, name: user.name, role: user.role as any };
}

/**
 * Create a facility with coords + a FacilityPolicy (geofence radius), plus N
 * EMPTY DOUBLES courts. Returns ids + the QR code data (qrCodeData) the
 * check-in flow keys on.
 */
export async function createFacility(opts: {
  latitude?: number;
  longitude?: number;
  radiusM?: number;
  courtCount?: number;
} = {}): Promise<{
  id: string;
  qrData: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  courtIds: string[];
}> {
  const latitude = opts.latitude ?? 37.5013;
  const longitude = opts.longitude ?? 127.0396;
  const radiusM = opts.radiusM ?? 100;
  const courtCount = opts.courtCount ?? 2;

  const facility = await prisma.facility.create({
    data: {
      name: `시설${uniq()}`,
      address: 'test address',
      latitude,
      longitude,
      policy: { create: { checkinRadiusM: radiusM } },
    },
  });

  const courtIds: string[] = [];
  for (let i = 1; i <= courtCount; i++) {
    const c = await prisma.court.create({
      data: { name: `코트${i}-${uniq()}`, facilityId: facility.id, gameType: 'DOUBLES', status: 'EMPTY' },
    });
    courtIds.push(c.id);
  }

  return { id: facility.id, qrData: facility.qrCodeData, latitude, longitude, radiusM, courtIds };
}

/** Create a club whose home facility is `facilityId`, with the given leader. */
export async function createClub(opts: {
  facilityId: string;
  leaderId: string;
  memberIds?: string[];
}): Promise<{ id: string; inviteCode: string }> {
  const club = await prisma.club.create({
    data: {
      name: `클럽${uniq()}`,
      inviteCode: `INV${uniq()}`.slice(0, 16),
      homeFacilityId: opts.facilityId,
      members: {
        create: [
          { userId: opts.leaderId, role: 'LEADER' },
          ...(opts.memberIds ?? []).map((id) => ({ userId: id, role: 'MEMBER' as const })),
        ],
      },
    },
  });
  return { id: club.id, inviteCode: club.inviteCode };
}

/** Add a club member (MEMBER role by default). */
export async function addClubMember(clubId: string, userId: string, role: 'LEADER' | 'STAFF' | 'MEMBER' = 'MEMBER') {
  await prisma.clubMember.create({ data: { clubId, userId, role } });
}

/**
 * Create an ACTIVE ClubSession (+ its OPEN FacilitySession) for a club at a
 * facility, scoped to the given courts. Mirrors what startSession produces but
 * without the API call, for suites that need a pre-existing active session.
 */
export async function createActiveClubSession(opts: {
  clubId: string;
  facilityId: string;
  startedById: string;
  courtIds: string[];
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
}): Promise<{ id: string; facilitySessionId: string }> {
  const facilitySession = await prisma.facilitySession.create({
    data: { facilityId: opts.facilityId, openedById: opts.startedById, status: 'OPEN' },
  });
  const session = await prisma.clubSession.create({
    data: {
      clubId: opts.clubId,
      facilityId: opts.facilityId,
      facilitySessionId: facilitySession.id,
      startedById: opts.startedById,
      status: 'ACTIVE',
      courtIds: opts.courtIds,
      checkInOpensAt: opts.checkInOpensAt ?? null,
      checkInClosesAt: opts.checkInClosesAt ?? null,
    },
  });
  // per-정모 코트 모델: 이 정모가 자기 코트를 '소유'하도록 clubSessionId 를 건다.
  // assignEntry/pushEntry 는 court.clubSessionId === board.clubSessionId 를 요구하므로
  // (프로덕션 startSession 과 동일) 시설 코트를 그대로 넘기면 배정이 거부된다.
  if (opts.courtIds.length > 0) {
    await prisma.court.updateMany({
      where: { id: { in: opts.courtIds } },
      data: { clubSessionId: session.id },
    });
  }
  return { id: session.id, facilitySessionId: facilitySession.id };
}

/** Directly create an active (un-checked-out) check-in for a user. */
export async function checkInUser(opts: {
  userId: string;
  facilityId: string;
  clubSessionId?: string;
}) {
  return prisma.checkIn.create({
    data: {
      userId: opts.userId,
      facilityId: opts.facilityId,
      clubSessionId: opts.clubSessionId ?? null,
    },
  });
}

export async function disconnect() {
  await prisma.$disconnect();
}

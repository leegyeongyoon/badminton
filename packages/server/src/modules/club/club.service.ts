import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { NotFoundError, ConflictError, ForbiddenError } from '../../utils/errors';
import type { CreateClubInput, ClubMemberResponse } from '@badminton/shared';
import type { ClubMemberRole } from '@badminton/shared';
import { PlayerStatus } from '@badminton/shared';

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export async function createClub(userId: string, input: CreateClubInput) {
  const club = await prisma.club.create({
    data: {
      name: input.name,
      inviteCode: generateInviteCode(),
      members: { create: { userId, role: 'LEADER' } },
    },
    include: { _count: { select: { members: true } } },
  });

  return {
    id: club.id,
    name: club.name,
    inviteCode: club.inviteCode,
    homeFacilityId: club.homeFacilityId,
    memberCount: club._count.members,
    createdAt: club.createdAt.toISOString(),
  };
}

export async function listMyClubs(userId: string) {
  const memberships = await prisma.clubMember.findMany({
    where: { userId },
    include: {
      club: { include: { _count: { select: { members: true } } } },
    },
  });

  return memberships.map((m) => ({
    id: m.club.id,
    name: m.club.name,
    inviteCode: m.club.inviteCode,
    homeFacilityId: m.club.homeFacilityId,
    memberCount: m.club._count.members,
    role: m.role,
    createdAt: m.club.createdAt.toISOString(),
  }));
}

export async function joinClub(userId: string, inviteCode: string) {
  const club = await prisma.club.findUnique({ where: { inviteCode } });
  if (!club) throw new NotFoundError('모임');

  const existing = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: club.id } },
  });
  if (existing) throw new ConflictError('이미 가입된 모임입니다');

  await prisma.clubMember.create({
    data: { userId, clubId: club.id },
  });

  return { success: true, clubId: club.id, clubName: club.name };
}

export async function getMembers(clubId: string, facilityId?: string): Promise<ClubMemberResponse[]> {
  const facilityFilter = facilityId
    ? { checkedOutAt: null, facilityId }
    : { checkedOutAt: null };

  const members = await prisma.clubMember.findMany({
    where: { clubId },
    include: {
      user: {
        include: {
          checkIns: {
            where: facilityFilter,
            take: 1,
          },
          turnPlayers: {
            where: {
              turn: { status: { in: ['WAITING', 'PLAYING'] } },
            },
            take: 1,
          },
        },
      },
    },
  });

  return members.map((m) => {
    const isCheckedIn = m.user.checkIns.length > 0;
    const isInTurn = m.user.turnPlayers.length > 0;
    let playerStatus: PlayerStatus | null = null;
    if (isCheckedIn) {
      const checkIn = m.user.checkIns[0];
      if (isInTurn) {
        playerStatus = PlayerStatus.IN_TURN;
      } else if (checkIn.restingAt) {
        playerStatus = PlayerStatus.RESTING;
      } else {
        playerStatus = PlayerStatus.AVAILABLE;
      }
    }

    return {
      userId: m.user.id,
      name: m.user.name,
      role: m.role as ClubMemberRole,
      isCheckedIn,
      facilityId: m.user.checkIns[0]?.facilityId ?? null,
      playerStatus,
    };
  });
}

export async function updateMemberRole(
  clubId: string,
  targetUserId: string,
  role: ClubMemberRole,
  requesterId: string,
) {
  // Verify requester is LEADER
  const requester = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: requesterId, clubId } },
  });
  if (!requester || requester.role !== 'LEADER') {
    throw new ForbiddenError('리더만 역할을 변경할 수 있습니다');
  }

  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  await prisma.clubMember.update({
    where: { userId_clubId: { userId: targetUserId, clubId } },
    data: { role },
  });

  return { success: true };
}

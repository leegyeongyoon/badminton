import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors';
import type { CreateClubInput } from '@badminton/shared';

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export async function createClub(userId: string, input: CreateClubInput) {
  const club = await prisma.club.create({
    data: {
      name: input.name,
      inviteCode: generateInviteCode(),
      members: { create: { userId, isLeader: true } },
    },
    include: { _count: { select: { members: true } } },
  });

  return {
    id: club.id,
    name: club.name,
    inviteCode: club.inviteCode,
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
    memberCount: m.club._count.members,
    isLeader: m.isLeader,
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

export async function getMembers(clubId: string, facilityId?: string) {
  const members = await prisma.clubMember.findMany({
    where: { clubId },
    include: {
      user: {
        include: {
          checkIns: {
            where: { checkedOutAt: null },
            take: 1,
          },
        },
      },
    },
  });

  return members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    isLeader: m.isLeader,
    isCheckedIn: m.user.checkIns.length > 0,
  }));
}

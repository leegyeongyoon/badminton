import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { RecruitmentStatus, CourtGameType } from '@badminton/shared';
import type { GroupRecruitmentResponse, CreateRecruitmentInput } from '@badminton/shared';
import { getIO } from '../../socket';
import { scheduleJob, cancelJob } from '../scheduler/scheduler.service';
import { registerTurn } from '../turn/turn.service';

const RECRUITMENT_EXPIRY_MINUTES = 15;

export async function createRecruitment(
  facilityId: string,
  userId: string,
  input: CreateRecruitmentInput,
): Promise<GroupRecruitmentResponse> {
  // Verify user is checked in
  const checkin = await prisma.checkIn.findFirst({
    where: { userId, facilityId, checkedOutAt: null },
  });
  if (!checkin) throw new BadRequestError('체크인 상태가 아닙니다');

  // Verify user is not already in a recruitment
  const existingMembership = await prisma.recruitmentMember.findFirst({
    where: {
      userId,
      recruitment: {
        facilityId,
        status: { in: ['RECRUITING', 'FULL'] },
      },
    },
  });
  if (existingMembership) throw new BadRequestError('이미 다른 모집에 참여 중입니다');

  const gameType = input.gameType || CourtGameType.DOUBLES;
  const playersRequired = gameType === CourtGameType.DOUBLES ? 4 : 2;

  const expiresAt = new Date(Date.now() + RECRUITMENT_EXPIRY_MINUTES * 60 * 1000);

  // Validate initial members
  const initialMemberIds = input.initialMemberIds || [];
  for (const mid of initialMemberIds) {
    const memberCheckin = await prisma.checkIn.findFirst({
      where: { userId: mid, facilityId, checkedOutAt: null, restingAt: null },
    });
    if (!memberCheckin) {
      const user = await prisma.user.findUnique({ where: { id: mid } });
      throw new BadRequestError(`${user?.name ?? mid}님은 대기 상태가 아닙니다`);
    }
  }

  const allMemberIds = [userId, ...initialMemberIds.filter((id) => id !== userId)];

  const recruitment = await prisma.groupRecruitment.create({
    data: {
      facilityId,
      createdById: userId,
      gameType,
      playersRequired,
      targetCourtId: input.targetCourtId || null,
      message: input.message || null,
      expiresAt,
      members: {
        create: allMemberIds.map((mid) => ({ userId: mid })),
      },
    },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });

  const mapped = mapRecruitment(recruitment);

  // Check if already full
  if (allMemberIds.length >= playersRequired) {
    await prisma.groupRecruitment.update({
      where: { id: recruitment.id },
      data: { status: RecruitmentStatus.FULL },
    });
    mapped.status = RecruitmentStatus.FULL;

    const io = getIO();
    io.to(`facility:${facilityId}`).emit('recruitment:full', mapped);
  } else {
    const io = getIO();
    io.to(`facility:${facilityId}`).emit('recruitment:created', mapped);
  }

  // Schedule expiry job
  await scheduleJob('recruitment_expired', recruitment.id, expiresAt);

  return mapped;
}

export async function listRecruitments(facilityId: string): Promise<GroupRecruitmentResponse[]> {
  const recruitments = await prisma.groupRecruitment.findMany({
    where: {
      facilityId,
      status: { in: ['RECRUITING', 'FULL'] },
    },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return recruitments.map(mapRecruitment);
}

export async function joinRecruitment(
  recruitmentId: string,
  userId: string,
): Promise<GroupRecruitmentResponse> {
  const recruitment = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });
  if (!recruitment) throw new NotFoundError('모집');
  if (recruitment.status !== RecruitmentStatus.RECRUITING) {
    throw new BadRequestError('모집 중인 상태가 아닙니다');
  }

  // Check user is checked in and available
  const checkin = await prisma.checkIn.findFirst({
    where: { userId, facilityId: recruitment.facilityId, checkedOutAt: null, restingAt: null },
  });
  if (!checkin) throw new BadRequestError('대기 상태가 아닙니다');

  // Check not already a member
  const existing = recruitment.members.find((m) => m.userId === userId);
  if (existing) throw new BadRequestError('이미 참여 중입니다');

  // Check not in another recruitment
  const otherMembership = await prisma.recruitmentMember.findFirst({
    where: {
      userId,
      recruitment: {
        facilityId: recruitment.facilityId,
        status: { in: ['RECRUITING', 'FULL'] },
      },
    },
  });
  if (otherMembership) throw new BadRequestError('이미 다른 모집에 참여 중입니다');

  await prisma.recruitmentMember.create({
    data: { recruitmentId, userId },
  });

  const newMemberCount = recruitment.members.length + 1;

  // Check if now full
  if (newMemberCount >= recruitment.playersRequired) {
    await prisma.groupRecruitment.update({
      where: { id: recruitmentId },
      data: { status: RecruitmentStatus.FULL },
    });
  }

  const updated = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });

  const mapped = mapRecruitment(updated!);
  const io = getIO();

  if (newMemberCount >= recruitment.playersRequired) {
    io.to(`facility:${recruitment.facilityId}`).emit('recruitment:full', mapped);
  } else {
    io.to(`facility:${recruitment.facilityId}`).emit('recruitment:playerJoined', mapped);
  }

  return mapped;
}

export async function leaveRecruitment(
  recruitmentId: string,
  userId: string,
): Promise<GroupRecruitmentResponse> {
  const recruitment = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: { members: true },
  });
  if (!recruitment) throw new NotFoundError('모집');
  if (!['RECRUITING', 'FULL'].includes(recruitment.status)) {
    throw new BadRequestError('모집 중이 아닙니다');
  }

  // Creator cannot leave, must cancel
  if (recruitment.createdById === userId) {
    throw new BadRequestError('모집 생성자는 탈퇴할 수 없습니다. 모집을 취소하세요.');
  }

  const member = recruitment.members.find((m) => m.userId === userId);
  if (!member) throw new BadRequestError('참여 중이 아닙니다');

  await prisma.recruitmentMember.delete({ where: { id: member.id } });

  // If was FULL, revert to RECRUITING
  if (recruitment.status === 'FULL') {
    await prisma.groupRecruitment.update({
      where: { id: recruitmentId },
      data: { status: RecruitmentStatus.RECRUITING },
    });
  }

  const updated = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });

  return mapRecruitment(updated!);
}

export async function registerRecruitment(
  recruitmentId: string,
  userId: string,
  courtId: string,
): Promise<GroupRecruitmentResponse> {
  const recruitment = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });
  if (!recruitment) throw new NotFoundError('모집');
  if (recruitment.status !== RecruitmentStatus.FULL) {
    throw new BadRequestError('모집이 완료되지 않았습니다');
  }

  // Only creator can register
  if (recruitment.createdById !== userId) {
    throw new ForbiddenError('모집 생성자만 순번을 등록할 수 있습니다');
  }

  const playerIds = recruitment.members.map((m) => m.userId);
  const targetCourtId = courtId || recruitment.targetCourtId;
  if (!targetCourtId) throw new BadRequestError('코트를 선택하세요');

  // Register the turn
  const turn = await registerTurn(targetCourtId, userId, playerIds, recruitment.gameType as CourtGameType);

  // Update recruitment status
  await prisma.groupRecruitment.update({
    where: { id: recruitmentId },
    data: {
      status: RecruitmentStatus.REGISTERED,
      registeredTurnId: turn.id,
    },
  });

  // Cancel expiry job
  await cancelJob(recruitmentId, 'recruitment_expired');

  const updated = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });

  const mapped = mapRecruitment(updated!);
  const io = getIO();
  io.to(`facility:${recruitment.facilityId}`).emit('recruitment:registered', mapped);

  return mapped;
}

export async function cancelRecruitment(
  recruitmentId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const recruitment = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: { members: true },
  });
  if (!recruitment) throw new NotFoundError('모집');

  // Only creator or admin can cancel
  if (recruitment.createdById !== userId) {
    const isAdmin = await prisma.facilityAdmin.findFirst({
      where: { facilityId: recruitment.facilityId, userId },
    });
    if (!isAdmin) {
      throw new ForbiddenError('모집 생성자 또는 관리자만 취소할 수 있습니다');
    }
  }

  if (!['RECRUITING', 'FULL'].includes(recruitment.status)) {
    throw new BadRequestError('취소할 수 없는 상태입니다');
  }

  await prisma.groupRecruitment.update({
    where: { id: recruitmentId },
    data: { status: RecruitmentStatus.CANCELLED },
  });

  await cancelJob(recruitmentId, 'recruitment_expired');

  const updated = await prisma.groupRecruitment.findUnique({
    where: { id: recruitmentId },
    include: {
      createdBy: true,
      targetCourt: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
  });

  const io = getIO();
  io.to(`facility:${recruitment.facilityId}`).emit('recruitment:cancelled', mapRecruitment(updated!));

  return { success: true };
}

function mapRecruitment(r: any): GroupRecruitmentResponse {
  return {
    id: r.id,
    facilityId: r.facilityId,
    createdById: r.createdById,
    createdByName: r.createdBy.name,
    gameType: r.gameType,
    playersRequired: r.playersRequired,
    targetCourtId: r.targetCourtId,
    targetCourtName: r.targetCourt?.name ?? null,
    status: r.status,
    message: r.message,
    members: r.members.map((m: any) => ({
      userId: m.userId,
      userName: m.user.name,
      joinedAt: m.joinedAt.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    registeredTurnId: r.registeredTurnId,
  };
}

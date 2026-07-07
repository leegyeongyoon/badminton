import { prisma } from '../../utils/prisma';
import { ConflictError, NotFoundError, BadRequestError } from '../../utils/errors';
import type {
  OperatorRequestCreateInput,
  OperatorRequestReviewInput,
} from '@badminton/shared';

type OperatorRequestRow = {
  id: string;
  userId: string;
  status: string;
  message: string | null;
  clubName: string | null;
  region: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

function toResponse(r: OperatorRequestRow) {
  return {
    id: r.id,
    userId: r.userId,
    status: r.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    message: r.message,
    clubName: r.clubName,
    region: r.region,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * PLAYER → 운영자 신청 생성.
 * - 이미 운영자(CLUB_LEADER) 또는 최고관리자(SUPER_ADMIN) 면 409 "이미 운영자예요".
 * - 이미 PENDING 신청이 있으면 409.
 * 그 외에는 PENDING 신청을 만든다.
 */
export async function createRequest(userId: string, input: OperatorRequestCreateInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('사용자');

  if (user.role === 'CLUB_LEADER' || user.role === 'SUPER_ADMIN') {
    throw new ConflictError('이미 운영자예요');
  }

  const pending = await prisma.operatorRequest.findFirst({
    where: { userId, status: 'PENDING' },
  });
  if (pending) {
    throw new ConflictError('이미 신청이 접수되어 검토 중이에요');
  }

  const created = await prisma.operatorRequest.create({
    data: { userId, message: input.message ?? null },
  });
  return toResponse(created);
}

/**
 * 본인의 최신 신청(없으면 null) + 현재 권한.
 */
export async function getMyRequest(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('사용자');

  const latest = await prisma.operatorRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    request: latest ? toResponse(latest) : null,
    role: user.role as 'SUPER_ADMIN' | 'FACILITY_ADMIN' | 'CLUB_LEADER' | 'PLAYER',
  };
}

/**
 * SUPER_ADMIN — 신청 목록. status 필터(기본 PENDING) + 신청자 요약 포함.
 */
export async function listRequests(status?: string) {
  const normalized = status ? status.toUpperCase() : undefined;
  const where =
    normalized === 'PENDING' || normalized === 'APPROVED' || normalized === 'REJECTED'
      ? { status: normalized as 'PENDING' | 'APPROVED' | 'REJECTED' }
      : {};

  const rows = await prisma.operatorRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, phone: true, createdAt: true } } },
  });

  return rows.map((r) => ({
    ...toResponse(r),
    requester: {
      id: r.user.id,
      name: r.user.name,
      phone: r.user.phone,
      createdAt: r.user.createdAt.toISOString(),
    },
  }));
}

/**
 * SUPER_ADMIN — 신청 승인/거절.
 * 트랜잭션: 신청 status + reviewedBy/At 설정; approve 면 신청자 user.role='CLUB_LEADER'.
 * 이미 검토된 신청(비 PENDING)이면 400.
 */
export async function reviewRequest(
  requestId: string,
  reviewerId: string,
  input: OperatorRequestReviewInput,
) {
  const existing = await prisma.operatorRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new NotFoundError('신청');

  if (existing.status !== 'PENDING') {
    throw new BadRequestError('이미 처리된 신청이에요');
  }

  const newStatus = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';

  const updated = await prisma.$transaction(async (tx) => {
    const req = await tx.operatorRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });

    const requester = await tx.user.findUnique({ where: { id: existing.userId } });

    if (input.decision === 'approve') {
      // 신청자가 이미 더 높은 권한이 아니라면 운영자(CLUB_LEADER)로 승격하고,
      // 운영자 회원가입으로 PENDING 이던 계정은 ACTIVE 로 풀어 승인 대기 벽을 해제한다.
      // (인앱 신청한 기존 활성 유저는 accountStatus 가 이미 ACTIVE 라 no-op.)
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(requester && requester.role === 'PLAYER' ? { role: 'CLUB_LEADER' as const } : {}),
          accountStatus: 'ACTIVE',
        },
      });
    } else {
      // 거절 — 운영자 회원가입으로 승인 대기(PENDING) 중이던 계정만 REJECTED 로 표시한다.
      // 이미 앱을 쓰던(ACTIVE) 유저가 인앱 운영자 신청을 거절당한 경우는 계정을 막지 않는다.
      if (requester && requester.accountStatus === 'PENDING') {
        await tx.user.update({
          where: { id: existing.userId },
          data: { accountStatus: 'REJECTED' },
        });
      }
    }

    return req;
  });

  return toResponse(updated);
}

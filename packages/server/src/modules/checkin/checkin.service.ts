import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
import { getIO } from '../../socket';

export async function checkIn(userId: string, qrData: string) {
  const facility = await prisma.facility.findUnique({ where: { qrCodeData: qrData } });
  if (!facility) throw new NotFoundError('시설');

  const existing = await prisma.checkIn.findFirst({
    where: { userId, facilityId: facility.id, checkedOutAt: null },
  });
  if (existing) throw new ConflictError('이미 체크인 상태입니다');

  const checkIn = await prisma.checkIn.create({
    data: { userId, facilityId: facility.id },
    include: { facility: true, user: true },
  });

  const io = getIO();
  io.to(`facility:${facility.id}`).emit('checkin:arrived', {
    userId,
    userName: checkIn.user.name,
    facilityId: facility.id,
  });

  return {
    id: checkIn.id,
    userId: checkIn.userId,
    facilityId: checkIn.facilityId,
    facilityName: checkIn.facility.name,
    checkedInAt: checkIn.checkedInAt.toISOString(),
  };
}

export async function checkOut(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
  });
  if (!active) throw new BadRequestError('체크인 상태가 아닙니다');

  await prisma.checkIn.update({
    where: { id: active.id },
    data: { checkedOutAt: new Date() },
  });

  const io = getIO();
  io.to(`facility:${active.facilityId}`).emit('checkin:left', {
    userId,
    facilityId: active.facilityId,
  });

  return { success: true };
}

export async function getCheckInStatus(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
    include: { facility: true },
  });

  if (!active) return null;
  return {
    id: active.id,
    userId: active.userId,
    facilityId: active.facilityId,
    facilityName: active.facility.name,
    checkedInAt: active.checkedInAt.toISOString(),
  };
}

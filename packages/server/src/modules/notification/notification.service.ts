import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

const expo = new Expo();

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.expoPushToken) return;

  // Save notification record
  await prisma.notification.create({
    data: {
      userId,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    },
  });

  if (!Expo.isExpoPushToken(user.expoPushToken)) {
    logger.warn(`Invalid push token for user ${userId}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: user.expoPushToken,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data,
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch (err) {
    logger.error(`Failed to send push to user ${userId}:`, err);
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  for (const userId of userIds) {
    await sendPushToUser(userId, payload);
  }
}

// ─── Predefined notification builders ───────────────────────

export async function notifyConeRegistered(userId: string, courtName: string, position: number) {
  await sendPushToUser(userId, {
    title: '고깔 등록 완료',
    body: `${courtName}, ${position}번째 대기입니다`,
    data: { type: 'coneRegistered', courtName },
  });
}

export async function notifyNextTurn(userId: string, courtName: string) {
  await sendPushToUser(userId, {
    title: '다음 차례!',
    body: `${courtName}에서 곧 시작합니다`,
    data: { type: 'nextTurn', courtName },
  });
}

export async function notifyGameStarted(userId: string, courtName: string) {
  await sendPushToUser(userId, {
    title: '게임 시작!',
    body: `${courtName}으로 입장하세요!`,
    data: { type: 'gameStarted', courtName },
  });
}

export async function notifyTimeWarning(userId: string, courtName: string, minutesLeft: number) {
  await sendPushToUser(userId, {
    title: '게임 종료 임박',
    body: `${courtName} 게임 ${minutesLeft}분 후 종료`,
    data: { type: 'timeWarning', courtName },
  });
}

export async function notifyGameBoardAssignment(
  userId: string, courtName: string, partnerNames: string[],
) {
  await sendPushToUser(userId, {
    title: '게임 편성됨',
    body: `${courtName}, ${partnerNames.join('/')}와 함께`,
    data: { type: 'gameBoardAssignment', courtName },
  });
}

export async function notifyGameBoardTurn(userId: string, courtName: string) {
  await sendPushToUser(userId, {
    title: '다음 게임 준비',
    body: `${courtName}에서 곧 시작합니다`,
    data: { type: 'gameBoardTurn', courtName },
  });
}

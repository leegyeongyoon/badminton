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

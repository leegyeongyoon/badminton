import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';
import { sendSms } from './sms.service';

const expo = new Expo();

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  // 인앱 알림함 기록은 푸시 토큰 유무와 무관하게 항상 남긴다 —
  // 토큰이 없으면(웹·권한 거부) 푸시만 생략되고, 알림 화면에서는 보인다.
  await prisma.notification.create({
    data: {
      userId,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    },
  });

  if (!user.expoPushToken) return;

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
    // Android: 'default' 채널(클라에서 HIGH importance로 생성)로 보내고 high priority로
    // 즉시 헤드업(팝업) 표시. iOS에는 무해(무시됨).
    channelId: 'default',
    priority: 'high',
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

/**
 * 운영진 승급 알림 — 인앱/푸시(무료·항상) + 문자(SOLAPI 설정 시에만, best-effort).
 * clubMember.role 이 STAFF 로 '처음' 바뀔 때 호출한다(중복 승급·강등은 호출부에서 걸러짐).
 * 문자 발송 실패는 삼켜서 상위 로직(역할 변경)에 영향을 주지 않는다.
 */
export async function notifyStaffPromoted(userId: string, clubName: string) {
  // 1) 인앱 알림함 + 푸시 (앱 설치·알림 허용자에게). 무료·즉시.
  await sendPushToUser(userId, {
    title: '운영진이 되셨어요 🎉',
    body: `'${clubName}' 모임의 운영진으로 임명되었어요. 이제 정모 운영·순번 관리를 할 수 있어요.`,
    data: { type: 'staffPromoted' },
  });

  // 2) 문자 (SOLAPI 설정된 경우에만). 앱을 안 깔았거나 알림을 꺼둔 사람에게도 확실히 도달.
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (user?.phone) {
      await sendSms(
        user.phone,
        `[콕고] ${clubName} 운영진이 되셨어요 🎉\n정모 운영·순번 관리·자동 편성을 하실 수 있어요.\n관리자 로그인 👉 badmintoncourt.store\n사용법 가이드 👉 badmintoncourt.store/help`,
      );
    }
  } catch (err) {
    logger.error('notifyStaffPromoted 문자 단계 실패(무시)', { err });
  }
}

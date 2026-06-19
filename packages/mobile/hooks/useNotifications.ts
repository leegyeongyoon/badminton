import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useBannerStore } from '../store/bannerStore';

/**
 * Notification types (from server push payloads) that mean "it's your turn /
 * game starting" and should raise the TurnBanner.
 */
const TURN_START_TYPES = new Set([
  'your_turn',
  'gameStarted',
  'gameBoardTurn',
  'nextTurn',
]);

// Module-level handler: how notifications behave while the app is foregrounded.
// expo-notifications 0.32 (SDK 54) uses shouldShowBanner / shouldShowList;
// shouldShowAlert is deprecated.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function isTurnStart(data: unknown): boolean {
  const type = (data as { type?: string } | undefined)?.type;
  return typeof type === 'string' && TURN_START_TYPES.has(type);
}

/**
 * Wires foreground + tap notification listeners. Native-only — no-op on web.
 * On a turn-start notification received in foreground, raises the TurnBanner.
 * On tapping a turn-start notification, navigates to my-status.
 * Mount once at the app root.
 */
export function useNotifications() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (isTurnStart(data)) {
        const courtName = (data as { courtName?: string })?.courtName;
        useBannerStore.getState().show({
          title: courtName ? `${courtName} 게임 시작` : '내 차례입니다',
          subtitle: notification.request.content.body ?? undefined,
          courtName,
        });
      }
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (isTurnStart(data)) {
        router.push('/(tabs)/my-status');
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [router]);
}

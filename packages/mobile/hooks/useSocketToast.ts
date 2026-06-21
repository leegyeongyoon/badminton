import { useCallback } from 'react';
import { useSocketEvent } from './useSocket';
import { showInfo, showSuccess } from '../utils/feedback';
import { useTurnStore } from '../store/turnStore';
import { useBannerStore } from '../store/bannerStore';
import { useCheckinStore } from '../store/checkinStore';

/**
 * Listens to key socket events and shows toast notifications.
 * Mount this in the main app layout (tabs).
 */
export function useSocketToast() {
  const onTurnStarted = useCallback((data: any) => {
    const court = data?.courtName || '';
    showSuccess(`${court} 게임이 시작되었습니다`);

    // If this started turn belongs to the current user, raise the TurnBanner.
    // The `turn:started` payload is a court-room broadcast ({ courtId, turnId }),
    // so we resolve "mine" against the locally-fetched myTurns list.
    const turnId = data?.turnId;
    if (turnId) {
      const myTurn = useTurnStore
        .getState()
        .myTurns.find((t) => t.turnId === turnId);
      if (myTurn) {
        useBannerStore.getState().show({
          title: myTurn.courtName ? `${myTurn.courtName} 게임 시작` : '내 차례입니다',
          subtitle: '탭하면 현황 보드가 열려요',
          courtName: myTurn.courtName,
          clubSessionId: useCheckinStore.getState().status?.clubSessionId ?? undefined,
        });
      }
    }
  }, []);

  const onTurnPromoted = useCallback((data: any) => {
    const court = data?.courtName || '';
    showInfo(`${court} 순번이 올라갔습니다`);
  }, []);

  const onTurnCompleted = useCallback((data: any) => {
    const court = data?.courtName || '';
    showInfo(`${court} 게임이 종료되었습니다`);
  }, []);

  const onGameTimeWarning = useCallback((_data: any) => {
    showInfo('게임 시간이 곧 만료됩니다');
  }, []);

  useSocketEvent('turn:started', onTurnStarted);
  useSocketEvent('turn:promoted', onTurnPromoted);
  useSocketEvent('turn:completed', onTurnCompleted);
  useSocketEvent('game:time_warning', onGameTimeWarning);
}

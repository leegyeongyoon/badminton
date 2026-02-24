import { useCallback } from 'react';
import { useSocketEvent } from './useSocket';
import { showInfo, showSuccess } from '../utils/feedback';

/**
 * Listens to key socket events and shows toast notifications.
 * Mount this in the main app layout (tabs).
 */
export function useSocketToast() {
  const onTurnStarted = useCallback((data: any) => {
    const court = data?.courtName || '';
    showSuccess(`${court} 게임이 시작되었습니다`);
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

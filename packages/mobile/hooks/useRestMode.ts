import { useCheckinStore } from '../store/checkinStore';
import { useSocketEvent } from './useSocket';

export function useRestMode() {
  const { isResting, restingSince, toggleRest, setRestState, status } = useCheckinStore();

  // Sync rest state from socket events
  useSocketEvent('player:restChanged', (data: { userId: string; isResting: boolean }) => {
    const currentUserId = useCheckinStore.getState().status?.userId;
    if (data.userId === currentUserId) {
      setRestState(data.isResting);
    }
  });

  const restDurationMinutes = restingSince
    ? Math.floor((Date.now() - new Date(restingSince).getTime()) / 60000)
    : 0;

  return {
    isResting,
    restingSince,
    restDurationMinutes,
    toggleRest,
    isCheckedIn: !!status,
  };
}

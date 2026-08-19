import { useCallback, useRef } from 'react';
import { router } from 'expo-router';
import { useSocketEvent } from './useSocket';
import { showError, showInfo, showSuccess } from '../utils/feedback';
import { useTurnStore } from '../store/turnStore';
import { useBannerStore } from '../store/bannerStore';
import { useCheckinStore } from '../store/checkinStore';
import { useAuthStore } from '../store/authStore';
import { rallyApi } from '../services/rally';

/**
 * Listens to key socket events and shows toast notifications.
 * Mount this in the main app layout (tabs).
 */
export function useSocketToast() {
  // De-dupe the "내 차례" banner per turn: the same turn:started now arrives on
  // BOTH the court room and the player's user room, so guard by turnId so the
  // banner is raised at most once per turn.
  const banneredTurnRef = useRef<string | null>(null);

  const onTurnStarted = useCallback((data: any) => {
    const court = data?.courtName || '';
    showSuccess(`${court} 게임이 시작되었습니다`);

    // If this started turn belongs to the current user, raise the TurnBanner.
    // Prefer the payload's playerIds (carried by the user-room emit) to resolve
    // "mine" immediately — the just-created turn may not yet be in the locally
    // fetched myTurns list. Fall back to the myTurns-by-turnId lookup when the
    // payload has no playerIds (e.g. an older court-room-only broadcast).
    const turnId = data?.turnId;
    if (!turnId) return;

    const currentUserId = useAuthStore.getState().user?.id;
    const playerIds: string[] | undefined = data?.playerIds;

    let mine = false;
    let courtName: string | undefined = data?.courtName || undefined;

    if (Array.isArray(playerIds) && currentUserId) {
      mine = playerIds.includes(currentUserId);
    } else {
      const myTurn = useTurnStore.getState().myTurns.find((t) => t.turnId === turnId);
      if (myTurn) {
        mine = true;
        courtName = courtName || myTurn.courtName;
      }
    }

    if (!mine) return;
    if (banneredTurnRef.current === turnId) return; // already shown for this turn
    banneredTurnRef.current = turnId;

    useBannerStore.getState().show({
      title: courtName ? `${courtName} 게임 시작` : '내 차례입니다',
      subtitle: '탭하면 현황 보드가 열려요',
      courtName,
      clubSessionId: useCheckinStore.getState().status?.clubSessionId ?? undefined,
    });
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

  // 콕고 랠리 대결 신청 수신 — 토스트의 action 버튼으로 바로 수락.
  // 수락하면 서버가 양측에 rally:matched를 쏘고, 게스트는 여기서 즉시 게임으로 이동.
  const onRallyInvited = useCallback((data: any) => {
    const matchId = data?.matchId;
    if (!matchId) return;
    const fromName = data?.from?.name || '상대';
    showInfo(`${fromName}님의 콕고 랠리 대결 신청 🏸`, {
      duration: 15000,
      action: {
        label: '수락',
        onPress: async () => {
          try {
            await rallyApi.accept(matchId);
            router.push(`/lab/rally?match=${matchId}&role=guest`);
          } catch (e: any) {
            showError(e?.message || '대결이 만료됐어요');
          }
        },
      },
    });
  }, []);

  useSocketEvent('turn:started', onTurnStarted);
  useSocketEvent('turn:promoted', onTurnPromoted);
  useSocketEvent('turn:completed', onTurnCompleted);
  useSocketEvent('game:time_warning', onGameTimeWarning);
  useSocketEvent('rally:invited', onRallyInvited);
}

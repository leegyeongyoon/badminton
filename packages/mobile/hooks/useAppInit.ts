import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useFacilityStore } from '../store/facilityStore';
import { useCheckinStore } from '../store/checkinStore';
import { useOnboardingStore } from '../store/onboardingStore';
import { usePendingJoinStore } from '../store/pendingJoinStore';
import { usePendingAttendStore } from '../store/pendingAttendStore';
import { usePushRegistration } from './usePushRegistration';

export function useAppInit() {
  const { loadUser, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { loadSelectedFacility, selectedFacilityLoaded } = useFacilityStore();
  const { fetchStatus } = useCheckinStore();
  const { loadOnboarding, isLoading: onboardingLoading } = useOnboardingStore();
  const { loadPendingJoin } = usePendingJoinStore();
  const { loadPendingAttend } = usePendingAttendStore();
  const [initDone, setInitDone] = useState(false);

  // Register for push notifications once authenticated (native-only; no-op on web).
  usePushRegistration();

  // Phase 1: Load all persisted state in parallel
  useEffect(() => {
    Promise.all([
      loadUser(),
      loadSelectedFacility(),
      loadOnboarding(),
      loadPendingJoin(),
      loadPendingAttend(),
    ]).finally(() => setInitDone(true));
  }, []);

  // Phase 2: After auth confirmed, fetch check-in status
  useEffect(() => {
    if (isAuthenticated) {
      fetchStatus();
    }
  }, [isAuthenticated]);

  const isReady = initDone && !authLoading && selectedFacilityLoaded && !onboardingLoading;

  return { isReady };
}

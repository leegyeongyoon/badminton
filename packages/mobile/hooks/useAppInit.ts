import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useFacilityStore } from '../store/facilityStore';
import { useCheckinStore } from '../store/checkinStore';
import { useOnboardingStore } from '../store/onboardingStore';

export function useAppInit() {
  const { loadUser, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { loadSelectedFacility, selectedFacilityLoaded } = useFacilityStore();
  const { fetchStatus } = useCheckinStore();
  const { loadOnboarding, isLoading: onboardingLoading } = useOnboardingStore();
  const [initDone, setInitDone] = useState(false);

  // Phase 1: Load all persisted state in parallel
  useEffect(() => {
    Promise.all([
      loadUser(),
      loadSelectedFacility(),
      loadOnboarding(),
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

import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../store/authStore';
import { useCheckinStore } from '../store/checkinStore';
import { useFacilityStore } from '../store/facilityStore';
import { Colors } from '../constants/colors';

export default function RootLayout() {
  const { loadUser, isAuthenticated, isLoading } = useAuthStore();
  const { fetchStatus } = useCheckinStore();
  const { selectedFacility, selectedFacilityLoaded, loadSelectedFacility } =
    useFacilityStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    loadUser();
    loadSelectedFacility();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStatus();
    }
  }, [isAuthenticated]);

  // Gating redirect logic
  useEffect(() => {
    if (isLoading || !selectedFacilityLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inFacilitySelect = segments[0] === 'facility-select';

    if (!isAuthenticated) {
      // Not logged in → auth screens
      if (!inAuthGroup) {
        router.replace('/(auth)');
      }
    } else if (!selectedFacility) {
      // Logged in but no facility → facility select
      if (!inFacilitySelect) {
        router.replace('/facility-select');
      }
    } else {
      // Logged in + facility selected → main app
      if (inAuthGroup || inFacilitySelect) {
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, selectedFacility, isLoading, selectedFacilityLoaded, segments]);

  if (isLoading || !selectedFacilityLoaded) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="facility-select" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="admin/index" />
        <Stack.Screen name="admin/rotation" />
        <Stack.Screen name="club/[id]" />
        <Stack.Screen name="club/[id]/session" />
        <Stack.Screen name="court/[id]" />
        <Stack.Screen name="display" />
        <Stack.Screen name="facility/[id]" />
        <Stack.Screen name="recruitment/create" />
        <Stack.Screen name="change-password" />
      </Stack>
    </>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});

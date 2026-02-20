import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../store/authStore';
import { useCheckinStore } from '../store/checkinStore';

export default function RootLayout() {
  const { loadUser, isAuthenticated, isLoading } = useAuthStore();
  const { fetchStatus } = useCheckinStore();

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStatus();
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="court" options={{ headerShown: false }} />
          <Stack.Screen name="display" options={{ headerShown: false }} />
        </Stack>
        <Redirect href="/(auth)" />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="court" options={{ headerShown: false }} />
        <Stack.Screen name="display" options={{ headerShown: false }} />
      </Stack>
      <Redirect href="/(tabs)" />
    </>
  );
}

import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { LINKING_PREFIX } from '../constants/linking';

export function useDeepLinking() {
  const router = useRouter();

  useEffect(() => {
    // Handle initial URL (cold start)
    const handleInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url) handleDeepLink(url);
    };

    // Handle URL while app is open
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    handleInitialURL();

    return () => subscription.remove();
  }, [router]);

  const handleDeepLink = (url: string) => {
    try {
      if (!url.startsWith(LINKING_PREFIX)) return;
      const path = url.replace(LINKING_PREFIX, '/');
      if (path && path !== '/') {
        router.push(path as any);
      }
    } catch {
      // Invalid URL, ignore
    }
  };
}

import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * In dev (Expo Go / web dev / emulators) talk to the local backend.
 * Android emulators reach the host machine via 10.0.2.2; everything else
 * (iOS sim, web) uses localhost.
 */
function getDevHost() {
  if (Platform.OS === 'android') return '10.0.2.2';
  return 'localhost';
}

/**
 * Resolve the API base URL.
 *
 * - In development (`__DEV__`), always prefer the local dev server so that
 *   `localhost:8081` web dev and emulators keep working regardless of any
 *   `extra.apiUrl` placeholder baked into the config.
 * - In production builds, use `extra.apiUrl` (injected from
 *   `EXPO_PUBLIC_API_URL` via app.config.ts / eas.json). Fall back to the
 *   dev host only if it's somehow missing, so the app never has an empty base.
 */
const configuredApiUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const devApiBase = `http://${getDevHost()}:3100`;

const API_BASE = __DEV__ ? devApiBase : configuredApiUrl ?? devApiBase;

export const API_URL = `${API_BASE}/api/v1`;
export const SOCKET_URL = API_BASE;

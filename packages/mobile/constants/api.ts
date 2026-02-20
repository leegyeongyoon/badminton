import { Platform } from 'react-native';

function getDevHost() {
  if (Platform.OS === 'android') return '10.0.2.2';
  return 'localhost';
}

const DEV_HOST = getDevHost();

export const API_URL = `http://${DEV_HOST}:3100/api/v1`;
export const SOCKET_URL = `http://${DEV_HOST}:3100`;

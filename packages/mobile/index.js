// ─────────────────────────────────────────────────────────────
// 커스텀 엔트리 — Sentry를 "다른 어떤 앱 모듈보다 먼저" 켠다.
// _layout 안에서 init하면 그보다 먼저 평가되는 모듈의 부팅 크래시를
// 못 잡는다(v29 즉사 크래시가 Sentry에 안 찍힌 원인). ES import는
// 호이스팅되므로 앱 본체는 반드시 require로 뒤에 로드한다.
// ─────────────────────────────────────────────────────────────
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

if (Platform.OS !== 'web') {
  Sentry.init({
    dsn: 'https://2c56521b4279ec7ea9a644510665e40a@o4511765184708608.ingest.us.sentry.io/4511765222129664',
    enabled: !__DEV__,
  });
}

require('expo-router/entry');

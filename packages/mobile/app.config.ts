import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * The static base lives in app.json (name, slug, icons, plugins, bundle ids,
 * version numbers, etc.). This file layers in values that must come from the
 * environment at build time so they can differ per EAS profile without
 * editing committed files:
 *
 *   - extra.apiUrl        ← EXPO_PUBLIC_API_URL  (production backend base URL)
 *   - extra.kakaoRestKey  ← EXPO_PUBLIC_KAKAO_REST_KEY (Kakao REST/JS app key)
 *                           Falls back to the "REPLACE_WITH_KAKAO_KEY"
 *                           placeholder from app.json; services/kakao.ts treats
 *                           that placeholder as "not configured" and never
 *                           attempts OAuth, so dev/web/preview never crash.
 *   - extra.eas.projectId ← EAS_PROJECT_ID / EXPO_PUBLIC_EAS_PROJECT_ID
 *                           (normally written into app.json by `eas init`)
 *
 * When an env var is absent (e.g. local dev), the placeholder from app.json
 * is kept. constants/api.ts ignores extra.apiUrl in `__DEV__`, and
 * usePushRegistration ignores the projectId placeholder, so the placeholders
 * are safe to ship — they only matter in real production builds.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl;
  const kakaoRestKey =
    process.env.EXPO_PUBLIC_KAKAO_REST_KEY ??
    config.extra?.kakaoRestKey ??
    'REPLACE_WITH_KAKAO_KEY';
  const projectId =
    process.env.EAS_PROJECT_ID ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    config.extra?.eas?.projectId;

  return {
    ...config,
    // `config` from app.json always has name/slug; assert to satisfy ExpoConfig.
    name: config.name ?? 'badminton-court',
    slug: config.slug ?? 'badminton-court',
    extra: {
      ...config.extra,
      apiUrl,
      kakaoRestKey,
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    },
  };
};

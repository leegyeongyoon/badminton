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
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    },
  };
};

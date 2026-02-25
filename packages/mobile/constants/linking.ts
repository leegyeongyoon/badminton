/**
 * Deep linking configuration for the app.
 * Maps URL paths to app routes.
 */
export const LINKING_PREFIX = 'badminton://';

export const DEEP_LINK_ROUTES = {
  // Main tabs
  courts: '/(tabs)',
  myStatus: '/(tabs)/my-status',
  more: '/(tabs)/more',

  // Legacy tab routes (redirect to new tabs)
  board: '/(tabs)',
  activity: '/(tabs)/my-status',
  settings: '/(tabs)/more',

  // Auth
  login: '/(auth)/login',
  register: '/(auth)/register',

  // Features
  checkin: '/checkin-modal',
  admin: '/admin',
  rotation: '/admin/rotation',
  notifications: '/notifications',
  facilitySelect: '/facility-select',
  gameBoard: '/game-board',

  // Dynamic routes
  court: (id: string) => `/court/${id}`,
  club: (id: string) => `/club/${id}`,
  clubSession: (id: string) => `/club/${id}/session`,
  facility: (id: string) => `/facility/${id}`,
} as const;

export type DeepLinkRoute = keyof typeof DEEP_LINK_ROUTES;

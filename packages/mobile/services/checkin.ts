import api from './api';

/**
 * A single ACTIVE 정모(ClubSession) at a facility, returned by the public
 * GET /checkin/active-sessions endpoint. Mirrors the shared
 * `ActiveClubSessionItem` type (mobile keeps its own copy to avoid pulling the
 * server-only @badminton/shared package into the metro bundle).
 */
export interface ActiveClubSessionItem {
  clubSessionId: string;
  clubName: string;
  facilityName: string;
  startedAt: string;
  scheduledStartAt?: string | null;
  title?: string | null;
}

export interface CheckInOptions {
  clubSessionId?: string;
  latitude: number;
  longitude: number;
}

/**
 * Payload for the unauthenticated guest self web check-in. At least one of
 * `qrData` (facility QR) or `clubSessionId` (per-정모 MEETUP QR) is required —
 * with a `clubSessionId` the server resolves the facility + geofence itself.
 */
export interface GuestCheckInParams {
  qrData?: string;
  clubSessionId?: string;
  name: string;
  skillLevel?: string;
  latitude: number;
  longitude: number;
}

/** Shape returned by POST /checkin/guest on success (HTTP 201). */
export interface GuestCheckInResponse {
  user: {
    id: string;
    phone: string | null;
    name: string;
    role: string;
    isGuest: boolean;
    createdAt: string;
  };
  token: string;
  checkIn: {
    id: string;
    userId: string;
    facilityId: string;
    clubSessionId: string | null;
    facilityName: string;
    feeAmount: number | null;
    feePaid: boolean;
    checkedInAt: string;
  };
}

export const checkinApi = {
  /**
   * Member check-in. Send EITHER a facility `qrData` OR (via opts) a
   * `clubSessionId` from a per-정모 MEETUP QR — at least one is required. When
   * only a `clubSessionId` is given the server resolves the facility/geofence.
   */
  checkIn: (qrData: string | undefined, opts: CheckInOptions) =>
    api.post('/checkin', { ...(qrData ? { qrData } : {}), ...opts }),
  checkOut: () => api.post('/checkin/checkout'),
  getStatus: () => api.get('/checkin/status'),
  setResting: () => api.post('/checkin/rest'),
  setAvailable: () => api.post('/checkin/available'),
  /**
   * Unauthenticated guest self check-in. Works WITHOUT a prior token — the
   * api request interceptor simply omits the Authorization header when no
   * accessToken is stored. The geofence applies (400 + details on out-of-range).
   */
  guestCheckIn: (params: GuestCheckInParams) =>
    api.post<GuestCheckInResponse>('/checkin/guest', params),
  /**
   * Unauthenticated lookup of the ACTIVE 정모(ClubSession) list for a facility
   * QR. Used by the guest/member check-in flow to disambiguate which 정모 to
   * attend when the facility hosts more than one active 정모.
   */
  getActiveSessions: (qrData: string) =>
    api.get<ActiveClubSessionItem[]>('/checkin/active-sessions', {
      params: { qrData },
    }),
};

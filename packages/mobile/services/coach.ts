import api from './api';

// 코치 마켓(숨고식) — 서버 coach/coachChat 모듈 DTO 미러.

export interface CoachCard {
  id: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  intro: string | null;
  regions: string | null;
  pricePerMonth: number | null;
  pricePerSession: number | null;
  certified: boolean;
  lessonCount: number;
}

export interface CoachDetail extends CoachCard {
  career: string | null;
  availableTimes: string | null;
  active: boolean;
  createdAt: string;
}

export interface CoachProfileInput {
  displayName?: string;
  photoUrl?: string | null;
  intro?: string | null;
  career?: string | null;
  regions?: string | null;
  pricePerMonth?: number | null;
  pricePerSession?: number | null;
  availableTimes?: string | null;
  active?: boolean;
}

export interface MyCoachLessonRow {
  offerId: string;
  clubId: string;
  clubName: string;
  summary: string;
  fee: number | null;
  capacity: number | null;
  enabled: boolean;
  students: number;
}

export const coachApi = {
  list: (params?: { region?: string; q?: string }) =>
    api.get<CoachCard[]>('/coaches', { params }).then((r) => r.data),
  get: (id: string) => api.get<CoachDetail>(`/coaches/${id}`).then((r) => r.data),
  me: () => api.get<CoachDetail | null>('/coaches/me').then((r) => r.data),
  upsertMe: (input: CoachProfileInput) => api.put<CoachDetail>('/coaches/me', input).then((r) => r.data),
  myLessons: () => api.get<MyCoachLessonRow[]>('/coaches/me/lessons').then((r) => r.data),
  setCertified: (id: string, certified: boolean) =>
    api.put<CoachDetail>(`/coaches/${id}/certified`, { certified }).then((r) => r.data),
};

// ── 코치 문의 채팅 ──────────────────────────────────────────────

export interface CoachChatMessage {
  id: string;
  fromCoach: boolean;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CoachChatThread {
  threadId: string;
  coachUserId: string;
  userId: string;
  clubId: string | null;
  clubName: string | null;
  mineIsCoach: boolean;
  coach: { profileId: string | null; displayName: string; photoUrl: string | null; certified: boolean };
  userName: string;
  messages: CoachChatMessage[];
}

export interface CoachThreadRow {
  threadId: string;
  mineIsCoach: boolean;
  counterpartName: string;
  counterpartPhotoUrl: string | null;
  certified: boolean;
  clubName: string | null;
  lastText: string | null;
  lastMessageAt: string;
  unread: number;
}

export const coachChatApi = {
  start: (coachProfileId: string, clubId?: string | null) =>
    api.post<CoachChatThread>('/coach-chat/start', { coachProfileId, clubId }).then((r) => r.data),
  threads: () =>
    api.get<{ asUser: CoachThreadRow[]; asCoach: CoachThreadRow[] }>('/coach-chat/threads').then((r) => r.data),
  unreadCount: () =>
    api.get<{ count: number }>('/coach-chat/unread-count', { _silent: true } as never).then((r) => r.data.count),
  load: (threadId: string) => api.get<CoachChatThread>(`/coach-chat/${threadId}`).then((r) => r.data),
  send: (threadId: string, text: string) =>
    api.post<CoachChatMessage>(`/coach-chat/${threadId}/messages`, { text }).then((r) => r.data),
};

// ── 레슨 상세(로스터·출석) — 운영진 또는 담당 코치 본인 ─────────

export interface LessonStudentRow {
  id: string;
  name: string;
  phone: string | null;
  isAppUser: boolean;
  status: string; // PENDING | CONFIRMED
  feePaid: boolean;
  enrollState: string; // ACTIVE | PAUSED | ENDED
  note: string | null;
  attendCount: number;
  createdAt: string;
}

export interface LessonDetail {
  offer: {
    id: string;
    clubId: string;
    clubName: string;
    coachName: string;
    coachIntro: string | null;
    coachCareer: string | null;
    coachProfileId: string | null;
    coachPhotoUrl: string | null;
    coachCertified: boolean;
    days: number[];
    start: string;
    end: string;
    fee: number | null;
    capacity: number | null;
    enabled: boolean;
    summary: string;
    applicants: number;
  };
  isCoach: boolean;
  roster: LessonStudentRow[];
}

export const lessonDetailApi = {
  get: (clubId: string, offerId: string) =>
    api.get<LessonDetail>(`/clubs/${clubId}/money/lessons/${offerId}`).then((r) => r.data),
  updateStudent: (clubId: string, offerId: string, appId: string, patch: { enrollState?: string; note?: string | null }) =>
    api.put(`/clubs/${clubId}/money/lessons/${offerId}/students/${appId}`, patch).then((r) => r.data),
  attendance: (clubId: string, offerId: string, date: string) =>
    api
      .get<{ applicationId: string; present: boolean }[]>(`/clubs/${clubId}/money/lessons/${offerId}/attendance`, { params: { date } })
      .then((r) => r.data),
  setAttendance: (clubId: string, offerId: string, date: string, entries: { applicationId: string; present: boolean }[]) =>
    api.post(`/clubs/${clubId}/money/lessons/${offerId}/attendance`, { date, entries }).then((r) => r.data),
};

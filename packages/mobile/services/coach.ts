import api from './api';

// 코치 마켓(숨고식) — 서버 coach/coachChat 모듈 DTO 미러.

export interface CoachCard {
  id: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  intro: string | null;
  regions: string | null; // 상세 지역 텍스트
  regionCodes: string[]; // 시/도 복수 선택
  pricePerMonth: number | null;
  pricePerSession: number | null;
  certified: boolean;
  lessonCount: number;
  // 이력서 기본 정보(원티드식)
  birthYear: number | null;
  playingYears: number | null;
  skillLevel: string | null; // S~F
  awardCount: number; // 입상 기록 수(신뢰 라인)
  ratingAvg: number | null;
  ratingCount: number;
  bookmarked: boolean;
}

export interface CoachCareerEntry {
  id: string;
  kind: string; // PLAYER | COACH | EDUCATION | CERT | AWARD
  title: string;
  org: string | null;
  startYm: string | null;
  endYm: string | null; // null = 현재
  description: string | null;
  division: string | null; // 입상 부문
  result: string | null; // 입상 성적
}

export interface CoachDetail extends CoachCard {
  career: string | null;
  availableTimes: string | null;
  active: boolean;
  createdAt: string;
  careerEntries: CoachCareerEntry[]; // 구조화 이력서(있으면 career 텍스트보다 우선)
  // 콕고 실운영 지표(관찰 기반 검증 경력) — 레슨반 운영 데이터 파생, 없으면 null.
  liveStats: { activeLessons: number; totalStudents: number; totalAttendance: number } | null;
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
  regionCodes?: string[] | null;
  birthYear?: number | null;
  playingYears?: number | null;
  skillLevel?: string | null;
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

export interface CoachReviewRow {
  id: string;
  authorName: string;
  rating: number;
  text: string | null;
  mine: boolean;
  createdAt: string;
}
export interface CoachReviews {
  avg: number | null;
  count: number;
  eligible: boolean;
  myReview: { rating: number; text: string | null } | null;
  reviews: CoachReviewRow[];
}

export const coachApi = {
  list: (params?: { region?: string; q?: string; regions?: string[]; skills?: string[]; certifiedOnly?: boolean; maxPrice?: number | null }) =>
    api
      .get<CoachCard[]>('/coaches', {
        params: {
          region: params?.region,
          q: params?.q,
          regions: params?.regions?.length ? params.regions.join(',') : undefined,
          skills: params?.skills?.length ? params.skills.join(',') : undefined,
          certified: params?.certifiedOnly ? '1' : undefined,
          maxPrice: params?.maxPrice || undefined,
        },
      })
      .then((r) => r.data),
  bookmarks: () => api.get<CoachCard[]>('/coaches/bookmarks').then((r) => r.data),
  setBookmark: (coachProfileId: string, on: boolean) =>
    (on ? api.post(`/coaches/${coachProfileId}/bookmark`) : api.delete(`/coaches/${coachProfileId}/bookmark`)).then((r) => r.data),
  reviews: (coachProfileId: string) => api.get<CoachReviews>(`/coaches/${coachProfileId}/reviews`).then((r) => r.data),
  upsertReview: (coachProfileId: string, rating: number, text?: string | null) =>
    api.put(`/coaches/${coachProfileId}/reviews`, { rating, text }).then((r) => r.data),
  deleteReview: (coachProfileId: string) => api.delete(`/coaches/${coachProfileId}/reviews`).then((r) => r.data),
  get: (id: string) => api.get<CoachDetail>(`/coaches/${id}`).then((r) => r.data),
  me: () => api.get<CoachDetail | null>('/coaches/me').then((r) => r.data),
  upsertMe: (input: CoachProfileInput) => api.put<CoachDetail>('/coaches/me', input).then((r) => r.data),
  myLessons: () => api.get<MyCoachLessonRow[]>('/coaches/me/lessons').then((r) => r.data),
  settlement: () => api.get<CoachSettlement>('/coaches/me/settlement').then((r) => r.data),
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
  kind: string; // LESSON | RECRUIT
  jobTitle: string | null;
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

export interface LessonWaitRow {
  id: string;
  rank: number;
  name: string;
  phone: string | null;
  isAppUser: boolean;
  createdAt: string;
}

export interface LessonBilling {
  offerId: string;
  clubName: string;
  coachName: string;
  summary: string;
  fee: number | null;
  activeStudents: number;
  paidCount: number;
  gross: number;
  feeRate: number;
  platformFee: number;
  coachPayout: number;
}

export interface CoachSettlement {
  feeRate: number;
  totalGross: number;
  totalPlatformFee: number;
  totalPayout: number;
  lessons: LessonBilling[];
  bank: { bankName: string | null; bankAccount: string | null; bankHolder: string | null } | null;
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
  waitlist: LessonWaitRow[];
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
  promoteWaitlist: (clubId: string, offerId: string, appId: string) =>
    api.post(`/clubs/${clubId}/money/lessons/${offerId}/waitlist/${appId}/promote`).then((r) => r.data),
  billing: (clubId: string, offerId: string) =>
    api.get<LessonBilling>(`/clubs/${clubId}/money/lessons/${offerId}/billing`).then((r) => r.data),
  // ── 월 수납(수동 입금확인) ──
  fees: (clubId: string, offerId: string, period: string) =>
    api.get<LessonFeesView>(`/clubs/${clubId}/money/lessons/${offerId}/fees`, { params: { period } }).then((r) => r.data),
  confirmFee: (clubId: string, offerId: string, applicationId: string, period: string) =>
    api.post(`/clubs/${clubId}/money/lessons/${offerId}/fees/confirm`, { applicationId, period }).then((r) => r.data),
  unconfirmFee: (clubId: string, offerId: string, applicationId: string, period: string) =>
    api.delete(`/clubs/${clubId}/money/lessons/${offerId}/fees/confirm`, { data: { applicationId, period } }).then((r) => r.data),
  shareLink: (clubId: string, offerId: string, regenerate = false) =>
    api.post<{ url: string; manageUrl: string }>(`/clubs/${clubId}/money/lessons/${offerId}/share-link`, { regenerate }).then((r) => r.data),
  addStudent: (clubId: string, offerId: string, input: { name: string; phone?: string }) =>
    api.post<{ id: string }>(`/clubs/${clubId}/money/lessons/${offerId}/students`, input).then((r) => r.data),
  remindFees: (clubId: string, offerId: string, period: string) =>
    api
      .post<{ message: string; unpaidCount: number; notifiedCount: number }>(`/clubs/${clubId}/money/lessons/${offerId}/fees/remind`, { period })
      .then((r) => r.data),
};

export interface LessonFeeRow {
  applicationId: string;
  name: string;
  isAppUser: boolean;
  enrollState: string; // ACTIVE | PAUSED
  status: 'UNPAID' | 'REPORTED' | 'CONFIRMED';
  amount: number | null;
  reportedAt: string | null;
  confirmedAt: string | null;
}

export interface LessonFeesView {
  offerId: string;
  period: string;
  fee: number | null;
  rows: LessonFeeRow[];
  confirmedCount: number;
  reportedCount: number;
  unpaidCount: number;
  totalConfirmed: number;
}

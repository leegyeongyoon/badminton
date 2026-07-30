import api from './api';

// 실험실(Lab) — 최고관리자 전용 상용 프로토타입. 서버 @badminton/shared 타입 미러.

export interface LabPartnerItem {
  userId: string;
  name: string;
  games: number;
}
export interface LabBadge {
  key: string;
  emoji: string;
  label: string;
  hint: string;
  earned: boolean;
}
export interface LabProfileResponse {
  userId: string;
  name: string;
  skillLevel: string | null;
  totalGames: number;
  thisMonthGames: number;
  streakDays: number;
  clubGames: { clubId: string; clubName: string; games: number }[];
  partners: LabPartnerItem[];
  badges: LabBadge[];
}

export interface LabSettlementMember {
  userId: string;
  name: string;
  isGuest: boolean;
  dues: number;
  sessions: number;
  sessionFees: number;
  splitFees: number;
  guestFees: number;
  total: number;
  duesPaid: boolean;
  balance: number;
}
export interface LabSettlementResponse {
  clubId: string;
  clubName: string;
  period: string;
  monthlyDuesAmount: number | null;
  duesAccountInfo: string | null;
  members: LabSettlementMember[];
  totals: { billed: number; paid: number; unpaid: number; unpaidCount: number };
}

export interface LabDuesConfig {
  clubId: string;
  clubName: string;
  duesPeriodType: string; // NONE|MONTHLY|QUARTERLY|HALF|YEARLY
  duesAmount: number | null;
  perSessionFee: number | null;
  guestFee: number | null;
  duesAccountInfo: string | null;
}

export interface LabSessionRow {
  id: string;
  title: string | null;
  date: string;
  attendees: number;
  rentalCost: number | null;
  perHead: number | null;
}

export interface LabGuestRow {
  checkInId: string;
  userId: string;
  name: string;
  date: string;
  sessionTitle: string | null;
  feeAmount: number | null;
  feePaid: boolean;
}

export interface LabGuestApplicationRow {
  id: string;
  name: string;
  isAppUser: boolean;
  isCheckedIn: boolean;
  skillLevel: string | null;
  gender: string | null;
  visitDate: string | null;
  phone: string | null;
  note: string | null;
  status: string; // PENDING | CONFIRMED | CANCELLED
  feeAmount: number | null;
  feePaid: boolean;
  createdAt: string;
}

/**
 * 회비 관리 API 어댑터 — MoneyManager 컴포넌트가 실험실(최고관리자)과
 * 모임 관리(운영진) 양쪽에서 같은 UI로 돌게 하는 공용 시그니처.
 */
export interface MoneyApi {
  getSettlement(clubId: string, period: string): Promise<LabSettlementResponse>;
  getSessions(clubId: string, period: string): Promise<LabSessionRow[]>;
  setRentalCost(clubId: string, sessionId: string, cost: number | null): Promise<void>;
  getGuests(clubId: string, period: string): Promise<LabGuestRow[]>;
  setGuestFeePaid(clubId: string, checkInId: string, paid: boolean): Promise<void>;
  getApplications(clubId: string): Promise<LabGuestApplicationRow[]>;
  updateApplication(clubId: string, id: string, patch: { feePaid?: boolean; status?: string }): Promise<void>;
  getConfig(clubId: string): Promise<LabDuesConfig>;
  setConfig(clubId: string, cfg: Partial<{ duesPeriodType: string; duesAmount: number | null; perSessionFee: number | null; guestFee: number | null; duesAccountInfo: string | null }>): Promise<void>;
  markPaid(clubId: string, userId: string, period: string, amount: number): Promise<void>;
  unmarkPaid(clubId: string, userId: string, period: string): Promise<void>;
}

// ─── 운영 정보(운동 일정·게스트 신청 정책) ───
export interface WeeklySlot { day: number; start: string; end: string }
export interface OperationConfig {
  clubId: string;
  clubName: string;
  weeklySchedule: WeeklySlot[];
  guestApplyEnabled: boolean;
  guestApplyDeadlineHours: number | null;
  maxGuestsPerDay: number | null;
  contactInfo: string | null; // 운영진 문의 채널(오픈채팅 링크·전화)
}

/** 운영진용 운영 정보 설정 — /clubs/:id/money/operation-config (staff 가드). */
export const clubOperationApi = {
  get: async (clubId: string): Promise<OperationConfig> =>
    (await api.get(`/clubs/${clubId}/money/operation-config`)).data,
  set: async (
    clubId: string,
    cfg: Partial<{ weeklySchedule: WeeklySlot[]; guestApplyEnabled: boolean; guestApplyDeadlineHours: number | null; maxGuestsPerDay: number | null; contactInfo: string | null }>,
  ): Promise<void> => {
    await api.put(`/clubs/${clubId}/money/operation-config`, cfg);
  },
};

// ─── 레슨 중개 MVP ───
export interface LessonOffer {
  id: string;
  coachName: string;
  coachIntro: string | null; // 한 줄 소개
  coachCareer: string | null; // 이력(줄바꿈 구분)
  days: number[]; // [1,3,5] = 월수금
  start: string;
  end: string;
  fee: number | null; // 월 레슨비
  capacity: number | null;
  enabled: boolean;
  summary: string; // "월·수·금 19:00~20:00"
  applicants: number;
  myStatus: string | null; // 내 신청 상태(회원 조회에서만)
  myFeePaid: boolean; // 내 레슨비 입금확인 여부(회원 조회에서만)
}
export interface LessonApplicationRow {
  id: string;
  offerId: string;
  offerSummary: string;
  coachName: string;
  name: string;
  isAppUser: boolean;
  phone: string | null;
  note: string | null;
  status: string; // PENDING | CONFIRMED | CANCELLED
  feePaid: boolean; // 레슨비 입금확인
  createdAt: string;
}

/** 레슨 관리 API 어댑터 — LessonManager가 실험실/운영진 양쪽에서 도는 공용 시그니처. */
export interface LessonApi {
  getOffers(clubId: string): Promise<LessonOffer[]>;
  saveOffer(clubId: string, offer: Partial<LessonOffer> & { id?: string }): Promise<void>;
  deleteOffer(clubId: string, offerId: string): Promise<void>;
  getApplications(clubId: string): Promise<LessonApplicationRow[]>;
  updateApplication(clubId: string, id: string, patch: { status?: string; feePaid?: boolean }): Promise<void>;
}

/** 운영진용 레슨 API — /clubs/:id/money/lessons* (staff 가드). */
export const clubLessonApi: LessonApi = {
  getOffers: async (clubId) => (await api.get(`/clubs/${clubId}/money/lessons`)).data || [],
  saveOffer: async (clubId, offer) => { await api.put(`/clubs/${clubId}/money/lessons`, offer); },
  deleteOffer: async (clubId, offerId) => { await api.delete(`/clubs/${clubId}/money/lessons/${offerId}`); },
  getApplications: async (clubId) => (await api.get(`/clubs/${clubId}/money/lesson-applications`)).data || [],
  updateApplication: async (clubId, id, patch) => { await api.put(`/clubs/${clubId}/money/lesson-applications/${id}`, patch); },
};

/** 최고관리자(실험실)용 레슨 API — /lab/* 경로. */
export const labLessonApi: LessonApi = {
  getOffers: async (clubId) => (await api.get(`/lab/clubs/${clubId}/lessons`)).data || [],
  saveOffer: async (clubId, offer) => { await api.put(`/lab/clubs/${clubId}/lessons`, offer); },
  deleteOffer: async (_clubId, offerId) => { await api.delete(`/lab/lesson-offers/${offerId}`); },
  getApplications: async (clubId) => (await api.get(`/lab/clubs/${clubId}/lesson-applications`)).data || [],
  updateApplication: async (_clubId, id, patch) => { await api.put(`/lab/lesson-applications/${id}`, patch); },
};

/** 회원용 — 활성 레슨 목록 + 신청. */
export const memberLessonApi = {
  list: async (clubId: string): Promise<LessonOffer[]> => (await api.get(`/clubs/${clubId}/lessons`)).data || [],
  apply: async (clubId: string, offerId: string, note?: string): Promise<{ id: string; message: string }> =>
    (await api.post(`/clubs/${clubId}/lessons/${offerId}/apply`, note ? { note } : {})).data,
};

// ─── 내 회비(회원) + 정산 통계(운영자) ───
export interface MyDuesPeriodRow {
  period: string;
  label: string;
  dues: number;
  sessions: number;
  sessionFees: number;
  splitFees: number;
  total: number;
  paid: boolean;
  paidAt: string | null;
  paidAmount: number | null;
}
export interface MyDuesResponse {
  clubId: string;
  clubName: string;
  duesPeriodType: string;
  duesAmount: number | null;
  accountInfo: string | null;
  periods: MyDuesPeriodRow[];
  totals: { paidThisYear: number; unpaidCount: number; unpaidAmount: number };
}
export interface MoneyStatRow { period: string; billed: number; paid: number; unpaid: number }

export const myDuesApi = {
  get: async (clubId: string): Promise<MyDuesResponse> =>
    (await api.get(`/clubs/${clubId}/my-dues`)).data,
};
export const moneyStatsApi = {
  get: async (clubId: string, months = 6): Promise<MoneyStatRow[]> =>
    (await api.get(`/clubs/${clubId}/money/stats`, { params: { months } })).data || [],
};

/** 운영진(LEADER/STAFF)용 — /clubs/:id/money/* (정식 경로). */
export const clubMoneyApi: MoneyApi = {
  getSettlement: async (clubId, period) => (await api.get(`/clubs/${clubId}/money/settlement`, { params: { period } })).data,
  getSessions: async (clubId, period) => (await api.get(`/clubs/${clubId}/money/sessions`, { params: { period } })).data || [],
  setRentalCost: async (clubId, sessionId, cost) => { await api.put(`/clubs/${clubId}/money/sessions/${sessionId}/rental-cost`, { cost }); },
  getGuests: async (clubId, period) => (await api.get(`/clubs/${clubId}/money/guests`, { params: { period } })).data || [],
  setGuestFeePaid: async (clubId, checkInId, paid) => { await api.put(`/clubs/${clubId}/money/checkins/${checkInId}/fee-paid`, { paid }); },
  getApplications: async (clubId) => (await api.get(`/clubs/${clubId}/money/guest-applications`)).data || [],
  updateApplication: async (clubId, id, patch) => { await api.put(`/clubs/${clubId}/money/guest-applications/${id}`, patch); },
  getConfig: async (clubId) => (await api.get(`/clubs/${clubId}/money/config`)).data,
  setConfig: async (clubId, cfg) => { await api.put(`/clubs/${clubId}/money/config`, cfg); },
  markPaid: async (clubId, userId, period, amount) => { await api.post(`/clubs/${clubId}/money/dues-payment`, { userId, period, amount }); },
  unmarkPaid: async (clubId, userId, period) => { await api.delete(`/clubs/${clubId}/money/dues-payment`, { data: { userId, period } }); },
};

export const labApi = {
  getMyProfile: async (): Promise<LabProfileResponse> => {
    const { data } = await api.get('/lab/me/profile');
    return data;
  },
  getUserProfile: async (userId: string): Promise<LabProfileResponse> => {
    const { data } = await api.get(`/lab/users/${userId}/profile`);
    return data;
  },
  getSettlement: async (clubId: string, period?: string): Promise<LabSettlementResponse> => {
    const { data } = await api.get(`/lab/clubs/${clubId}/settlement`, {
      params: period ? { period } : {},
    });
    return data;
  },
  markPaid: async (clubId: string, userId: string, period: string, amount: number): Promise<void> => {
    await api.post(`/lab/clubs/${clubId}/dues-payment`, { userId, period, amount });
  },
  unmarkPaid: async (clubId: string, userId: string, period: string): Promise<void> => {
    await api.delete(`/lab/clubs/${clubId}/dues-payment`, { data: { userId, period } });
  },
  setDuesAccount: async (clubId: string, info: string | null): Promise<void> => {
    await api.put(`/lab/clubs/${clubId}/dues-account`, { info });
  },
  getDuesConfig: async (clubId: string): Promise<LabDuesConfig> => {
    const { data } = await api.get(`/lab/clubs/${clubId}/dues-config`);
    return data;
  },
  getGuestApplications: async (clubId: string): Promise<LabGuestApplicationRow[]> => {
    const { data } = await api.get(`/lab/clubs/${clubId}/guest-applications`);
    return data || [];
  },
  updateGuestApplication: async (id: string, patch: { feePaid?: boolean; status?: string }): Promise<void> => {
    await api.put(`/lab/guest-applications/${id}`, patch);
  },
  getGuests: async (clubId: string, period?: string): Promise<LabGuestRow[]> => {
    const { data } = await api.get(`/lab/clubs/${clubId}/guests`, { params: period ? { period } : {} });
    return data || [];
  },
  setGuestFeePaid: async (checkInId: string, paid: boolean): Promise<void> => {
    await api.put(`/lab/checkins/${checkInId}/fee-paid`, { paid });
  },
  getSessions: async (clubId: string, period?: string): Promise<LabSessionRow[]> => {
    const { data } = await api.get(`/lab/clubs/${clubId}/sessions`, { params: period ? { period } : {} });
    return data || [];
  },
  setRentalCost: async (sessionId: string, cost: number | null): Promise<void> => {
    await api.put(`/lab/club-sessions/${sessionId}/rental-cost`, { cost });
  },
  setDuesConfig: async (
    clubId: string,
    cfg: Partial<{ duesPeriodType: string; duesAmount: number | null; perSessionFee: number | null; guestFee: number | null; duesAccountInfo: string | null }>,
  ): Promise<void> => {
    await api.put(`/lab/clubs/${clubId}/dues-config`, cfg);
  },
};

/** 최고관리자(실험실)용 MoneyApi — /lab/* 경로를 공용 시그니처로 감싼다. */
export const labMoneyApi: MoneyApi = {
  getSettlement: (clubId, period) => labApi.getSettlement(clubId, period),
  getSessions: (clubId, period) => labApi.getSessions(clubId, period),
  setRentalCost: (_clubId, sessionId, cost) => labApi.setRentalCost(sessionId, cost),
  getGuests: (clubId, period) => labApi.getGuests(clubId, period),
  setGuestFeePaid: (_clubId, checkInId, paid) => labApi.setGuestFeePaid(checkInId, paid),
  getApplications: (clubId) => labApi.getGuestApplications(clubId),
  updateApplication: (_clubId, id, patch) => labApi.updateGuestApplication(id, patch),
  getConfig: (clubId) => labApi.getDuesConfig(clubId),
  setConfig: (clubId, cfg) => labApi.setDuesConfig(clubId, cfg),
  markPaid: (clubId, userId, period, amount) => labApi.markPaid(clubId, userId, period, amount),
  unmarkPaid: (clubId, userId, period) => labApi.unmarkPaid(clubId, userId, period),
};

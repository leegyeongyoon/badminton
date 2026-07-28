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

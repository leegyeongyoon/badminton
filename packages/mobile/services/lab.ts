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

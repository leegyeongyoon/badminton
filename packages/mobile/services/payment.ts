import api from './api';

// 결제·정산 — 서버 payment 모듈 미러(MOCK provider, PG 교체 시 그대로 사용).

const BRAND_LABEL: Record<string, string> = {
  VISA: 'VISA', MASTER: 'Mastercard', KOOKMIN: 'KB국민', SHINHAN: '신한', LOCAL: '카드',
};
export const cardBrandLabel = (brand: string | null | undefined) =>
  (brand && BRAND_LABEL[brand]) || brand || '카드';

export interface PaymentMethod {
  id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpiry: string;
  isDefault: boolean;
  createdAt: string;
}

export interface PaymentHistoryRow {
  id: string;
  period: string;
  orderName: string | null;
  amount: number;
  status: string; // PAID | FAILED | CANCELLED
  failReason: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  paidAt: string;
}

export interface CoachPayout {
  id: string;
  coachProfileId: string;
  coachName: string;
  period: string;
  totalAmount: number;
  feeAmount: number;
  payoutAmount: number;
  paymentCount: number;
  bankSnapshot: string | null;
  status: string; // PENDING | PAID
  paidAt: string | null;
}

export interface PlatformSummary {
  period: string;
  grossPaid: number;
  feeRevenue: number;
  paymentCount: number;
  failedCount: number;
  payoutPending: number;
  payoutPaid: number;
  batches: CoachPayout[];
}

export const paymentApi = {
  registerCard: (card: { cardNumber: string; expiry: string; birthOrBiz: string }) =>
    api.post<PaymentMethod>('/payments/methods', card).then((r) => r.data),
  cards: () => api.get<PaymentMethod[]>('/payments/methods').then((r) => r.data),
  deleteCard: (id: string) => api.delete(`/payments/methods/${id}`).then((r) => r.data),
  setDefaultCard: (id: string) => api.put(`/payments/methods/${id}/default`).then((r) => r.data),
  history: () => api.get<PaymentHistoryRow[]>('/payments/history').then((r) => r.data),
  // 코치 정산
  myPayouts: () => api.get<CoachPayout[]>('/coaches/me/payouts').then((r) => r.data),
  setBank: (bank: { bankName: string; bankAccount: string; bankHolder: string }) =>
    api.put('/coaches/me/bank', bank).then((r) => r.data),
  // 플랫폼 운영(최고관리자)
  runBilling: (period?: string) => api.post('/payments/run-billing', { period }).then((r) => r.data),
  closeSettlement: (period?: string) =>
    api.post<{ period: string; batches: CoachPayout[]; unlinkedCount: number; unlinkedAmount: number }>('/payments/settlements/close', { period }).then((r) => r.data),
  executePayout: (payoutId: string) => api.post<CoachPayout>(`/payments/settlements/${payoutId}/pay`).then((r) => r.data),
  platformSummary: (period?: string) =>
    api.get<PlatformSummary>('/payments/platform-summary', { params: { period } }).then((r) => r.data),
};

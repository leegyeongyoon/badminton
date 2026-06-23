import api from './api';
import type {
  OperatorRequestResponse,
  OperatorRequestWithRequester,
  OperatorRequestMeResponse,
} from '@badminton/shared';

export const operatorRequestApi = {
  // PLAYER → 운영자 신청 생성 (사유 선택)
  create: (message?: string) =>
    api.post<OperatorRequestResponse>('/operator-requests', { message }),

  // 본인의 최신 신청 + 현재 권한
  me: () => api.get<OperatorRequestMeResponse>('/operator-requests/me'),

  // SUPER_ADMIN — 신청 목록 (기본 pending)
  list: (status: string = 'pending') =>
    api.get<OperatorRequestWithRequester[]>(`/operator-requests?status=${status}`),

  // SUPER_ADMIN — 승인/거절
  review: (id: string, decision: 'approve' | 'reject', note?: string) =>
    api.post<OperatorRequestResponse>(`/operator-requests/${id}/review`, { decision, note }),
};

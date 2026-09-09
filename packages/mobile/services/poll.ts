import api from './api';

// 정모 즉석 투표 — 운영진이 만들고 체크인 회원이 참여, 실시간 집계.

export interface PollOption {
  index: number;
  text: string;
  count: number;
  voters?: { userId: string; name: string }[]; // 익명 아니고 운영진일 때만
}

export interface Poll {
  id: string;
  clubSessionId: string;
  question: string;
  options: PollOption[];
  anonymous: boolean;
  multi: boolean;
  status: 'OPEN' | 'CLOSED';
  totalVoters: number;
  myVotes: number[];
  createdAt: string;
  closesAt: string | null;
}

export const pollApi = {
  list: (clubSessionId: string) =>
    api.get<Poll[]>(`/club-sessions/${clubSessionId}/polls`).then((r) => r.data),
  create: (
    clubSessionId: string,
    body: { question: string; options: string[]; anonymous?: boolean; multi?: boolean; closesInMin?: number },
  ) => api.post<Poll>(`/club-sessions/${clubSessionId}/polls`, body).then((r) => r.data),
  get: (pollId: string) => api.get<Poll>(`/polls/${pollId}`).then((r) => r.data),
  vote: (pollId: string, optionIndex: number) =>
    api.post<Poll>(`/polls/${pollId}/vote`, { optionIndex }).then((r) => r.data),
  close: (pollId: string) => api.post<Poll>(`/polls/${pollId}/close`).then((r) => r.data),
  remove: (pollId: string) => api.delete(`/polls/${pollId}`).then((r) => r.data),
};

import api from './api';

// 코치 구인 공고 + 원티드식 지원 관리 — 서버 coachJob 모듈 DTO 미러.

export interface JobPostCard {
  id: string;
  title: string;
  clubId: string | null;
  clubName: string | null; // null = 개인 요청
  region: string; // 표시 라벨(시/도 조합 + 상세)
  regionCodes: string[];
  regionDetail: string | null;
  scheduleLabel: string;
  payLabel: string;
  thumbnail: string | null; // 첫 첨부 사진
  status: string; // OPEN | CLOSED
  applicants: number;
  createdAt: string;
}

export interface JobApplicantRow {
  id: string;
  coachProfileId: string;
  coachUserId: string;
  displayName: string;
  photoUrl: string | null;
  certified: boolean;
  intro: string | null;
  regions: string | null;
  birthYear: number | null;
  playingYears: number | null;
  skillLevel: string | null;
  careerSummary: string | null;
  message: string | null;
  status: string; // APPLIED | INTERVIEW | OFFERED | ACCEPTED | DECLINED | REJECTED
  offerTerms: OfferTerms | null;
  offerSentAt: string | null;
  interviewWhen: string | null;
  interviewPlace: string | null;
  interviewNote: string | null;
  managerNote: string | null;
  createdAt: string;
}

export interface OfferTerms {
  payMonthly?: number | null;
  paySession?: number | null;
  days?: number[] | null;
  start?: string | null;
  end?: string | null;
  startNote?: string | null;
  message?: string | null;
}

export interface JobPostDetail extends JobPostCard {
  description: string | null;
  days: number[] | null;
  start: string | null;
  end: string | null;
  payMonthly: number | null;
  paySession: number | null;
  payNegotiable: boolean;
  requirements: string | null;
  photos: string[];
  authorUserId: string;
  authorName: string;
  canManage: boolean;
  myApplication: {
    id: string; status: string; message: string | null;
    offerTerms: OfferTerms | null; offerSentAt: string | null;
    interviewWhen: string | null; interviewPlace: string | null; interviewNote: string | null;
  } | null;
  invited: boolean;
  applications: JobApplicantRow[] | null;
}

export interface JobPostInput {
  clubId?: string | null;
  photos?: string[] | null;
  regionCodes?: string[] | null;
  title?: string;
  description?: string | null;
  days?: number[] | null;
  start?: string | null;
  end?: string | null;
  payMonthly?: number | null;
  paySession?: number | null;
  payNegotiable?: boolean;
  requirements?: string | null;
  region?: string | null;
  status?: string;
}

export interface MyJobRow extends JobPostCard {
  newApplicants: number;
}

export interface MyApplicationRow {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  post: JobPostCard;
  interviewWhen: string | null;
  interviewPlace: string | null;
  interviewNote: string | null;
}

export interface JobInviteRow {
  id: string;
  message: string | null;
  status: string; // SENT | DECLINED
  createdAt: string;
  post: JobPostCard;
  applied: boolean;
}

export interface InterviewInfo {
  when?: string | null;
  place?: string | null;
  note?: string | null;
}

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  APPLIED: '지원 완료',
  INTERVIEW: '면접 진행',
  OFFERED: '오퍼레터',
  ACCEPTED: '채용 확정',
  DECLINED: '오퍼 거절',
  REJECTED: '불합격',
  WITHDRAWN: '철회함',
};

export const coachJobApi = {
  list: (params?: { region?: string; q?: string; regions?: string[] }) =>
    api
      .get<JobPostCard[]>('/coach-jobs', {
        params: { ...params, regions: params?.regions?.length ? params.regions.join(',') : undefined },
      })
      .then((r) => r.data),
  get: (id: string) => api.get<JobPostDetail>(`/coach-jobs/${id}`).then((r) => r.data),
  create: (input: JobPostInput) => api.post<{ id: string }>('/coach-jobs', input).then((r) => r.data),
  update: (id: string, patch: JobPostInput) => api.put(`/coach-jobs/${id}`, patch).then((r) => r.data),
  remove: (id: string) => api.delete(`/coach-jobs/${id}`).then((r) => r.data),
  apply: (id: string, message?: string) =>
    api.post<{ id: string }>(`/coach-jobs/${id}/apply`, { message }).then((r) => r.data),
  setApplicationStatus: (postId: string, appId: string, status: string, offer?: OfferTerms, interview?: InterviewInfo) =>
    api.put<{ threadId?: string }>(`/coach-jobs/${postId}/applications/${appId}`, { status, offer, interview }).then((r) => r.data),
  setInterview: (postId: string, appId: string, interview: InterviewInfo) =>
    api.put(`/coach-jobs/${postId}/applications/${appId}/interview`, interview).then((r) => r.data),
  setNote: (postId: string, appId: string, note: string | null) =>
    api.put(`/coach-jobs/${postId}/applications/${appId}/note`, { note }).then((r) => r.data),
  mine: () => api.get<MyJobRow[]>('/coach-jobs/mine').then((r) => r.data),
  invites: () => api.get<JobInviteRow[]>('/coach-jobs/invites').then((r) => r.data),
  declineInvite: (inviteId: string) => api.put(`/coach-jobs/invites/${inviteId}/decline`).then((r) => r.data),
  invite: (postId: string, coachProfileId: string, message?: string) =>
    api.post<{ id: string }>(`/coach-jobs/${postId}/invite`, { coachProfileId, message }).then((r) => r.data),
  applied: () => api.get<MyApplicationRow[]>('/coach-jobs/applied').then((r) => r.data),
};

// ── 이력서(경력 엔트리) ─────────────────────────────────────────

export interface CareerEntry {
  id?: string;
  kind: string; // PLAYER | COACH | EDUCATION | CERT | AWARD
  title: string;
  org: string | null;
  startYm: string | null;
  endYm: string | null;
  description: string | null;
  division?: string | null; // 입상 부문
  result?: string | null; // 입상 성적
}

export const CAREER_KIND_LABEL: Record<string, string> = {
  PLAYER: '선수 경력',
  COACH: '지도 경력',
  EDUCATION: '학력',
  CERT: '자격증',
  AWARD: '입상 기록',
};

// 공인 스포츠지도사(배드민턴) 프리셋 — 국민체육진흥공단 국가자격 체계 + 협회 자격.
export const CERT_PRESETS = [
  '생활스포츠지도사 2급 (배드민턴)',
  '생활스포츠지도사 1급 (배드민턴)',
  '전문스포츠지도사 2급 (배드민턴)',
  '전문스포츠지도사 1급 (배드민턴)',
  '유소년스포츠지도사 (배드민턴)',
  '노인스포츠지도사 (배드민턴)',
  '대한배드민턴협회 심판 자격',
];

export const AWARD_DIVISIONS = ['남단', '여단', '남복', '여복', '혼복', '단체전'];
export const AWARD_RESULTS = ['우승', '준우승', '3위', '입상'];

export const careerApi = {
  get: () => api.get<CareerEntry[]>('/coaches/me/career').then((r) => r.data),
  set: (entries: CareerEntry[]) => api.put<CareerEntry[]>('/coaches/me/career', { entries }).then((r) => r.data),
};

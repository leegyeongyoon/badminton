import api from './api';

/** 모임 채팅/건의 메시지 (서버 ClubMessageResponse 미러). */
export interface ClubMessage {
  id: string;
  clubId: string;
  userId: string;
  authorName: string;
  authorSkillLevel: string | null;
  text: string;
  type: 'CHAT' | 'REQUEST';
  /** 짝 요청(REQUEST)에서 지목한 모임원. */
  mentioned: { userId: string; name: string }[];
  createdAt: string;
}

export interface SendMessageBody {
  text: string;
  type?: 'CHAT' | 'REQUEST';
  mentionedUserIds?: string[];
}

export const chatApi = {
  // 최근 메시지(오름차순). before(ISO createdAt 커서)로 과거 페이지네이션.
  listMessages: (clubId: string, opts: { before?: string; limit?: number } = {}) =>
    api.get<ClubMessage[]>(`/clubs/${clubId}/messages`, {
      params: {
        ...(opts.before ? { before: opts.before } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
      },
    }),

  // 메시지 전송 — type=REQUEST 면 짝 요청(mentionedUserIds 지목).
  sendMessage: (clubId: string, body: SendMessageBody) =>
    api.post<ClubMessage>(`/clubs/${clubId}/messages`, body),
};

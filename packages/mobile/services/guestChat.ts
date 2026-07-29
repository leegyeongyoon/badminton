import api from './api';

// 게스트 문의 채팅 — 게스트(공개) 측과 운영진(staff) 측 API.
// 게스트 익명 접근 토큰 = threadId(브라우저/기기 localStorage 보관).

export interface GuestChatMessage {
  id: string;
  fromStaff: boolean;
  authorName: string;
  text: string;
  createdAt: string;
}
export interface GuestChatThread {
  threadId: string;
  clubId: string;
  clubName: string;
  guestName: string | null;
  closed: boolean;
  messages: GuestChatMessage[];
}
export interface StaffThreadRow {
  threadId: string;
  guestName: string | null;
  isAppUser: boolean;
  lastText: string | null;
  lastMessageAt: string;
  staffUnread: number;
  closed: boolean;
}

/** 게스트(공개) 측 — /guest-chat/*. 로그인 상태면 토큰이 자동 첨부돼 앱 회원으로 연결. */
export const guestChatApi = {
  start: async (params: { clubId?: string; inviteCode?: string; name?: string }): Promise<GuestChatThread> =>
    (await api.post('/guest-chat/start', params, { _silent: true } as any)).data,
  load: async (threadId: string): Promise<GuestChatThread> =>
    (await api.get(`/guest-chat/${threadId}`, { _silent: true } as any)).data,
  send: async (threadId: string, text: string, name?: string): Promise<GuestChatMessage> =>
    (await api.post(`/guest-chat/${threadId}/messages`, { text, name }, { _silent: true } as any)).data,
};

/** 운영진 측 — /clubs/:id/money/guest-threads* (staff 가드). */
export const staffGuestChatApi = {
  list: async (clubId: string): Promise<StaffThreadRow[]> =>
    (await api.get(`/clubs/${clubId}/money/guest-threads`)).data || [],
  unreadCount: async (clubId: string): Promise<number> =>
    (await api.get(`/clubs/${clubId}/money/guest-threads/unread-count`)).data?.count ?? 0,
  load: async (clubId: string, threadId: string): Promise<GuestChatThread> =>
    (await api.get(`/clubs/${clubId}/money/guest-threads/${threadId}`)).data,
  send: async (clubId: string, threadId: string, text: string): Promise<GuestChatMessage> =>
    (await api.post(`/clubs/${clubId}/money/guest-threads/${threadId}/messages`, { text })).data,
  setClosed: async (clubId: string, threadId: string, closed: boolean): Promise<void> => {
    await api.put(`/clubs/${clubId}/money/guest-threads/${threadId}/closed`, { closed });
  },
};

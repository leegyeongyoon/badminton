import { create } from 'zustand';
import { chatApi, ClubMessage, SendMessageBody } from '../services/chat';

interface ChatState {
  // 모임별 메시지 목록 (오름차순 — 마지막이 최신).
  messagesByClub: Record<string, ClubMessage[]>;
  loadingByClub: Record<string, boolean>;
  fetchMessages: (clubId: string) => Promise<void>;
  sendMessage: (clubId: string, body: SendMessageBody) => Promise<ClubMessage>;
  // 소켓 'clubMessage:new' 수신 시 append (중복 id 방지).
  appendMessage: (msg: ClubMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesByClub: {},
  loadingByClub: {},

  fetchMessages: async (clubId) => {
    set((s) => ({ loadingByClub: { ...s.loadingByClub, [clubId]: true } }));
    try {
      const { data } = await chatApi.listMessages(clubId, { limit: 50 });
      set((s) => ({
        messagesByClub: { ...s.messagesByClub, [clubId]: data },
        loadingByClub: { ...s.loadingByClub, [clubId]: false },
      }));
    } catch {
      set((s) => ({ loadingByClub: { ...s.loadingByClub, [clubId]: false } }));
    }
  },

  sendMessage: async (clubId, body) => {
    const { data } = await chatApi.sendMessage(clubId, body);
    // 낙관적 추가 — 소켓 echo 가 와도 appendMessage 가 중복을 막는다.
    get().appendMessage(data);
    return data;
  },

  appendMessage: (msg) => {
    set((s) => {
      const list = s.messagesByClub[msg.clubId] ?? [];
      if (list.some((m) => m.id === msg.id)) return s; // 이미 있음
      return {
        messagesByClub: { ...s.messagesByClub, [msg.clubId]: [...list, msg] },
      };
    });
  },
}));

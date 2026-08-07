import api from './api';

export interface CreateFacilityBody {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

// 카카오 장소검색 결과(서버 프록시 반환).
export interface PlaceSearchResult {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export const facilityApi = {
  list: () => api.get('/facilities'),
  // 운영자가 장소(체육관)를 추가. 이름만 필수, 좌표/주소는 선택.
  create: (body: CreateFacilityBody) => api.post('/facilities', body),
  // 카카오 장소 검색(서버 프록시) — "OO배드민턴/체육관" → 이름·주소·좌표.
  searchPlaces: (q: string) =>
    api.get<PlaceSearchResult[]>(`/facilities/search?q=${encodeURIComponent(q)}`),
  get: (id: string) => api.get(`/facilities/${id}`),
  getQr: (id: string) => api.get(`/facilities/${id}/qr`),
  getPolicy: (id: string) => api.get(`/facilities/${id}/policy`),
  updatePolicy: (id: string, data: any) => api.put(`/facilities/${id}/policy`, data),
  getBoard: (id: string) => api.get(`/facilities/${id}/board`),
  getCourts: (id: string) => api.get(`/facilities/${id}/courts`),
  getPlayers: (id: string) => api.get(`/facilities/${id}/players`),
  getCapacity: (id: string) => api.get(`/facilities/${id}/capacity`),
  getCurrentSession: (id: string) => api.get(`/facilities/${id}/sessions/current`),
  openSession: (id: string, note?: string) => api.post(`/facilities/${id}/sessions/open`, { note }),
};

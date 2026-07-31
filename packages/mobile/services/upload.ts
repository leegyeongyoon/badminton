import { Platform } from 'react-native';
import api from './api';
import { API_ORIGIN } from '../constants/api';

// 이미지 업로드 — 서버가 sharp 로 WebP 재인코딩 후 `/uploads/xxx.webp` 상대 경로를 준다.

/** 서버가 주는 상대 경로(/uploads/…)를 화면에서 쓸 절대 URL로 변환. 이미 절대면 그대로. */
export function absolutizeUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * 로컬 이미지(uri)를 서버에 업로드하고 상대 경로 URL을 돌려준다.
 * - 네이티브: RN FormData 파일 파트({ uri, name, type })
 * - 웹: expo-image-picker 가 주는 data/blob URI 를 Blob 으로 변환해 업로드
 */
export async function uploadImage(uri: string): Promise<string> {
  const form = new FormData();

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, 'photo.jpg');
  } else {
    const name = uri.split('/').pop() || 'photo.jpg';
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    form.append('file', { uri, name, type: mime } as unknown as Blob);
  }

  const { data } = await api.post<{ url: string }>('/uploads/image', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000, // 사진은 기본 15s 보다 여유 있게
  });
  return data.url;
}

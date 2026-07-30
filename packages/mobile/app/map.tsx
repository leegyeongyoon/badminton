import { Redirect } from 'expo-router';

// 지도는 '모임 찾기'의 [목록|지도] 토글로 통합됐다 — 옛 경로는 리다이렉트.
export default function MapRedirect() {
  return <Redirect href={'/discover?view=map' as never} />;
}

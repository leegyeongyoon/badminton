import { Redirect } from 'expo-router';

// 코치 찾기는 하단 탭 "코치"(구인·구직 허브)로 통합됐다 — 옛 경로는 리다이렉트.
export default function CoachesRedirect() {
  return <Redirect href={'/(tabs)/coach-hub' as never} />;
}

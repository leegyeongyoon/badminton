import { Redirect } from 'expo-router';

// 코치 프로필·이력이 /coach/resume 한 화면으로 통합됨 — 기존 딥링크 호환용 리다이렉트.
export default function CoachEditRedirect() {
  return <Redirect href={'/coach/resume' as never} />;
}

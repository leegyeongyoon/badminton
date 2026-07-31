// 피처 플래그.
//
// COACH_MARKET_ENABLED — 코치 구인·구직(공고·이력서·오퍼레터·정산) 영역.
//  • 개발(__DEV__): 항상 켜짐(로컬 검증용)
//  • 프로덕션 빌드: 기본 꺼짐 → 코치 탭이 "준비 중" 티저로 노출(탭 구성은 유지)
//  • 오픈 시점: 빌드 env 에 EXPO_PUBLIC_COACH_MARKET=1 을 넣고 재배포하면 열린다
export const COACH_MARKET_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_COACH_MARKET === '1';

// PAYMENTS_ENABLED — 레슨비 인앱 결제(임시 MOCK → PG 교체 예정).
//  • 개발: 켜짐(서버 PAYMENTS_MOCK=1 필요) • 프로덕션: 기본 꺼짐(버튼 숨김 + 서버도 차단)
export const PAYMENTS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_PAYMENTS === '1';

// 시/도 지역 코드(표준 17개) — 서버 coach.service 의 REGION_CODES 와 동일해야 한다.
// 프로필 활동 지역·공고 지역의 복수 선택, 피드/코치 찾기 필터의 단일 기준.
export const REGIONS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const;

export type RegionCode = (typeof REGIONS)[number];

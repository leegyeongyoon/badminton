// 웹 전용 출석 진입 경로. /attend는 iOS 유니버설 링크(AASA)에 등록돼 있어
// QR을 찍으면 설치된 앱이 열리는데, 1.0.5 시작 크래시 장애 동안은 그게 곧
// 먹통이라 QR payload를 이 경로로 우회한다(서버 getSessionQr 참조).
// 1.0.6 안정화 후 서버 payload를 /attend로 되돌리면 이 파일은 무해한 별칭으로 남는다.
export { default } from './attend';

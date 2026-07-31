// RN CLI 오토링킹/codegen 설정.
// google-signin은 iOS에서 완전 제외한다(iOS 구글 로그인은 브라우저 방식).
// 주의: package.json의 expo.autolinking.ios.exclude(Expo 모듈 제외)와 반드시
// 한 쌍으로 유지할 것 — Expo쪽만 제외하면 RN codegen이 이 라이브러리의
// Fabric 컴포넌트(RNGoogleSigninButton)를 등록부에 넣는데 클래스는 링크가
// 안 돼 nil → 부팅 즉사(프로덕션 1.0.2 크래시의 원인). 여기(platforms.ios:
// null)까지 제외해야 등록부에서도 빠져 일관된다.
module.exports = {
  dependencies: {
    '@react-native-google-signin/google-signin': {
      platforms: {
        ios: null, // iOS 완전 제외 (autolinking + codegen)
      },
    },
  },
};

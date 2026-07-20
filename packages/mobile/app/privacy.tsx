import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../constants/theme';

/**
 * 개인정보처리방침 — 로그인 없이 볼 수 있는 공개 화면.
 *
 * 웹으로 export 되면 https://badmintoncourt.store/privacy 로 공개되며, App Store/
 * Google Play 등록 시 요구하는 개인정보처리방침 URL 로 사용한다. 앱 안에서도
 * 설정에서 링크로 접근한다. 루트 게이트(_layout)의 예외에 'privacy' 를 넣어
 * 비로그인/게스트도 볼 수 있게 한다.
 *
 * ⚠️ 아래 [대표자명] / [문의 이메일] 은 실제 값으로 교체 필요(운영자 정보).
 */

const CONTACT_NAME = '이경윤';
const CONTACT_EMAIL = 'lgy000720@gmail.com';
const EFFECTIVE_DATE = '2026년 7월 7일';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '제1조 (수집하는 개인정보 항목)',
    body:
      '· 회원가입·로그인: 이름, 전화번호, 비밀번호(전화번호 가입 시), 카카오/구글 계정 식별자 및 프로필(소셜 로그인 시)\n' +
      '· 프로필: 급수, 성별, 생년(선택)\n' +
      '· 서비스 이용: 정모 출석 기록, 게임/경기 기록, 모임 가입 정보\n' +
      '· 위치정보: 정모 출석 확인 및 주변 체육관 검색을 위한 기기 위치(이용 시점에만)\n' +
      '· 기기정보: 푸시 알림 토큰, 접속 로그, 기기·브라우저 정보\n' +
      '· 카메라: QR 코드 스캔 용도로만 사용하며, 촬영 이미지는 저장하지 않습니다.',
  },
  {
    title: '제2조 (개인정보의 수집 및 이용 목적)',
    body:
      '· 회원 식별 및 인증, 서비스 제공\n' +
      '· 정모 출석·게임 편성·현황 제공 등 핵심 기능 운영\n' +
      '· 푸시 알림 발송\n' +
      '· 서비스 운영·개선 및 문의 응대',
  },
  {
    title: '제3조 (개인정보의 보유 및 이용 기간)',
    body:
      '· 회원 탈퇴 시 수집된 개인정보를 지체 없이 파기합니다.\n' +
      '· 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.',
  },
  {
    title: '제4조 (개인정보의 제3자 제공)',
    body:
      '· 서비스는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다.\n' +
      '· 법령에 근거가 있거나 이용자의 동의가 있는 경우에 한하여 제공합니다.\n' +
      '· 서비스는 이용자의 개인정보를 판매하지 않습니다.',
  },
  {
    title: '제5조 (개인정보 처리의 위탁)',
    body:
      '원활한 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁할 수 있습니다.\n' +
      '· 소셜 로그인 인증: 카카오, 구글\n' +
      '· 푸시 알림 발송: Expo (Expo Push Notifications)\n' +
      '· 서비스 인프라·호스팅: 클라우드 인프라 제공자\n' +
      '위탁 시 관련 법령에 따라 개인정보가 안전하게 관리되도록 합니다.',
  },
  {
    title: '제6조 (이용자 및 법정대리인의 권리)',
    body:
      '· 이용자는 언제든지 본인의 개인정보를 조회·수정·삭제하거나 처리정지, 회원 탈퇴를 요청할 수 있습니다.\n' +
      '· 요청은 아래 문의처로 접수할 수 있으며, 지체 없이 조치합니다.',
  },
  {
    title: '제7조 (개인정보의 파기)',
    body:
      '· 보유기간이 경과하거나 처리목적이 달성된 경우 지체 없이 파기합니다.\n' +
      '· 전자적 파일 형태의 정보는 복구 불가능한 방법으로 삭제합니다.',
  },
  {
    title: '제8조 (위치정보의 이용)',
    body:
      '· 위치정보는 정모 출석 확인 및 주변 체육관 검색 목적으로 이용 시점에만 사용하며, 별도로 저장·추적하지 않습니다.\n' +
      '· 이용자는 기기 설정에서 위치 접근 권한을 언제든 해제할 수 있습니다.',
  },
  {
    title: '제9조 (아동의 개인정보)',
    body:
      '· 서비스는 만 14세 미만 아동을 주 이용 대상으로 하지 않습니다.\n' +
      '· 만 14세 미만 이용자의 경우 법정대리인의 동의가 필요합니다.',
  },
  {
    title: '제10조 (개인정보 보호책임자 및 문의처)',
    body:
      `· 개인정보 보호책임자: ${CONTACT_NAME}\n` +
      `· 문의 이메일: ${CONTACT_EMAIL}\n` +
      '개인정보 관련 문의·불만·피해구제는 위 연락처로 접수할 수 있습니다.',
  },
  {
    title: '제11조 (고지의 의무)',
    body:
      '· 본 개인정보처리방침의 내용이 변경되는 경우, 시행일과 변경 사항을 서비스 내 공지사항 또는 본 페이지를 통해 고지합니다.',
  },
];

export default function PrivacyScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.divider, backgroundColor: colors.surface, paddingTop: insets.top + 8 }]}>
        <Text
          style={[styles.back, { color: colors.primary }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
        >
          ‹ 뒤로
        </Text>
        <Text style={[styles.headerTitle, { color: colors.text }]}>개인정보처리방침</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.appName, { color: colors.text }]}>콕고</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>시행일: {EFFECTIVE_DATE}</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          &lsquo;콕고&rsquo;(이하 &ldquo;서비스&rdquo;)는 이용자의 개인정보를 중요하게 생각하며,
          「개인정보 보호법」 등 관련 법령을 준수합니다. 본 방침은 서비스가 어떤 개인정보를 수집하고
          어떻게 이용·보호하는지 안내합니다.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{s.title}</Text>
            <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>{s.body}</Text>
          </View>
        ))}

        <Text style={[styles.footer, { color: colors.textLight }]}>
          부칙: 본 방침은 {EFFECTIVE_DATE}부터 시행합니다.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'web' ? spacing.lg : spacing.xxxl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { ...typography.body1, fontWeight: '600', width: 48 },
  headerTitle: { ...typography.subtitle1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  appName: { ...typography.h2, marginBottom: spacing.xs },
  meta: { ...typography.caption, marginBottom: spacing.lg },
  intro: { ...typography.body2, lineHeight: 22, marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.subtitle2, marginBottom: spacing.sm },
  sectionBody: { ...typography.body2, lineHeight: 22 },
  footer: { ...typography.caption, marginTop: spacing.lg },
});

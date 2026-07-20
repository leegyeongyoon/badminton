import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../constants/theme';

/**
 * 계정·데이터 삭제 요청 안내 — 로그인 없이 볼 수 있는 공개 화면.
 *
 * 웹으로 export 되면 https://badmintoncourt.store/delete-account 로 공개되며,
 * Google Play 데이터 보안 양식이 요구하는 "계정 삭제 요청 URL" 로 사용한다.
 * 루트 게이트(_layout)의 예외에 'delete-account' 를 넣어 비로그인도 볼 수 있게 한다.
 */

const CONTACT_EMAIL = 'lgy000720@gmail.com';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. 삭제 요청 방법',
    body:
      `· 아래 이메일로 "계정 삭제 요청"이라고 보내주세요: ${CONTACT_EMAIL}\n` +
      '· 본인 확인을 위해 가입하신 이름과 전화번호(또는 소셜 로그인에 사용한 이메일)를 함께 적어주세요.\n' +
      '· 앱에서 직접 삭제를 원하시는 경우에도 위 이메일로 요청하시면 처리해 드립니다.',
  },
  {
    title: '2. 삭제되는 데이터',
    body:
      '요청이 확인되면 계정과 관련된 아래 개인정보가 모두 삭제됩니다.\n' +
      '· 이름, 전화번호, 이메일, 비밀번호\n' +
      '· 프로필 정보(급수, 성별 등)\n' +
      '· 정모 출석 기록, 게임/경기 기록, 모임 가입 정보\n' +
      '· 푸시 알림 토큰, 접속 로그',
  },
  {
    title: '3. 처리 기간',
    body:
      '· 요청 접수 및 본인 확인 후 지체 없이(영업일 기준 최대 30일 이내) 파기합니다.\n' +
      '· 전자적 파일은 복구 불가능한 방법으로 삭제합니다.',
  },
  {
    title: '4. 보관되는 데이터',
    body:
      '· 관련 법령에 따라 일정 기간 보존이 필요한 정보(예: 관계 법령상 보관 의무가 있는 기록)는 해당 기간 동안 안전하게 보관 후 파기합니다.\n' +
      '· 그 외 계정과 연결된 개인정보는 삭제됩니다.',
  },
];

export default function DeleteAccountScreen() {
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>계정·데이터 삭제</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.appName, { color: colors.text }]}>콕고 계정 삭제 요청</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          콕고 계정과 그에 연결된 개인정보의 삭제를 요청하실 수 있습니다. 아래 안내에 따라 요청해 주시면
          지체 없이 처리해 드립니다.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{s.title}</Text>
            <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>{s.body}</Text>
          </View>
        ))}

        <Text style={[styles.footer, { color: colors.textLight }]}>
          문의: {CONTACT_EMAIL}
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
  appName: { ...typography.h2, marginBottom: spacing.sm },
  intro: { ...typography.body2, lineHeight: 22, marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.subtitle2, marginBottom: spacing.sm },
  sectionBody: { ...typography.body2, lineHeight: 22 },
  footer: { ...typography.caption, marginTop: spacing.lg },
});

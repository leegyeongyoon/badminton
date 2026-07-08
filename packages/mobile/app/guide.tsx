import type { ComponentProps } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';

/**
 * 앱 사용법 가이드 — 회원(참가자)용 + 운영자(관리자)용 안내.
 *
 * 설정/더보기에서 언제든 열 수 있고, 관리자 대시보드에서 '사용법 가이드'로
 * 진입한다. 운영자로 처음 승인된 사용자는 관리자 대시보드 진입 시 한 번 자동으로
 * 보여준다(guide?role=operator). 로그인 사용자 전용 화면이라 게이트 예외는 없다.
 */

type Step = {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  desc: string;
};

const MEMBER_STEPS: Step[] = [
  {
    icon: 'qrcode-scan',
    title: 'QR로 체크인',
    desc: '정모 장소에 도착하면 QR 코드를 스캔하세요. 위치 인증과 함께 출석이 완료돼요.',
  },
  {
    icon: 'badminton',
    title: '게임 기다리기',
    desc: '운영자가 출석한 사람들로 게임을 편성하고 코트에 배정해요. 편하게 기다리면 돼요.',
  },
  {
    icon: 'bell-ring',
    title: '내 차례 확인',
    desc: '내 게임이 잡히면 알림이 와요. ‘내 현황’에서 순서와 예상 대기 시간을 볼 수 있어요.',
  },
  {
    icon: 'view-dashboard',
    title: '현황판 보기',
    desc: '어느 코트에서 누가 뛰는지, 대기 순서가 어떤지 실시간으로 확인할 수 있어요.',
  },
];

const OPERATOR_STEPS: Step[] = [
  {
    icon: 'play-circle',
    title: '운영 시작',
    desc: '시설에 체크인한 뒤 ‘운영 시작’을 누르면 회원들이 출석하고 참여할 수 있어요.',
  },
  {
    icon: 'puzzle',
    title: '게임 편성 (운영판)',
    desc: '‘운영판’에서 가용 멤버를 골라 게임을 만들고 코트에 걸어요. 급수·성별·게임 수로 필터하거나 ‘자동편성’으로 한 번에 짤 수도 있어요.',
  },
  {
    icon: 'target',
    title: '코트 관리',
    desc: '게임을 코트에 배정·시작·종료하고, 필요하면 ‘대기로’ 되돌리거나 다른 코트로 옮길 수 있어요.',
  },
  {
    icon: 'camera',
    title: 'QR 출석 받기',
    desc: 'QR 화면을 띄우면 회원들이 스캔해서 바로 출석해요.',
  },
  {
    icon: 'monitor',
    title: '모니터로 공유',
    desc: '모니터 화면을 큰 TV·모니터에 띄우면 모두가 코트 현황을 한눈에 볼 수 있어요.',
  },
];

function StepCard({ index, step, color }: { index: number; step: Step; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
      <View style={[styles.iconCircle, { backgroundColor: color + '1A' }]}>
        <MaterialCommunityIcons name={step.icon} size={24} color={color} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.stepNum, { backgroundColor: color }]}>
            <Text style={styles.stepNumText}>{index + 1}</Text>
          </View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{step.title}</Text>
        </View>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{step.desc}</Text>
      </View>
    </View>
  );
}

export default function GuideScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const operatorFirst = role === 'operator';

  const memberSection = (
    <View key="member" style={styles.section}>
      <View style={styles.sectionHead}>
        <MaterialCommunityIcons name="account-group" size={20} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>회원(참가자)으로 이용하기</Text>
      </View>
      {MEMBER_STEPS.map((s, i) => (
        <StepCard key={s.title} index={i} step={s} color={colors.primary} />
      ))}
    </View>
  );

  const operatorSection = (
    <View key="operator" style={styles.section}>
      <View style={styles.sectionHead}>
        <MaterialCommunityIcons name="shield-account" size={20} color="#F59E0B" />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>운영자(관리자)로 운영하기</Text>
      </View>
      {OPERATOR_STEPS.map((s, i) => (
        <StepCard key={s.title} index={i} step={s} color="#F59E0B" />
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.divider, backgroundColor: colors.surface }]}>
        <Text
          style={[styles.back, { color: colors.primary }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
        >
          ‹ 뒤로
        </Text>
        <Text style={[styles.headerTitle, { color: colors.text }]}>앱 사용법</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.hero, { color: colors.text }]}>콕고, 이렇게 써요</Text>
        <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
          출석부터 게임 편성·현황까지 한 번에. 아래 순서만 알면 바로 시작할 수 있어요.
        </Text>

        {operatorFirst ? [operatorSection, memberSection] : [memberSection, operatorSection]}

        <View style={{ height: spacing.xxl }} />
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
  hero: { ...typography.h2, marginBottom: spacing.xs },
  heroSub: { ...typography.body2, lineHeight: 22, marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.subtitle1 },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardTitle: { ...typography.subtitle2, flex: 1 },
  cardDesc: { ...typography.body2, lineHeight: 21 },
});

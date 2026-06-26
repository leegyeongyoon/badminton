import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuthStore, KakaoNotConfiguredError } from '../../store/authStore';
import { startKakaoWebLogin } from '../../services/kakao';
import { useTheme } from '../../hooks/useTheme';
import { useFormValidation } from '../../hooks/useFormValidation';
import { compose, required, phone as phoneRule, password as passwordRule } from '../../utils/validation';
import { typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showError, showInfo } from '../../utils/feedback';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ScreenContainer } from '../../components/ui/ScreenContainer';

// Kakao brand colors (카카오 디자인 가이드): yellow container, near-black label.
const KAKAO_YELLOW = '#FEE500';
const KAKAO_LABEL = '#191600';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [kakaoNotice, setKakaoNotice] = useState<string | null>(null);
  const { login, kakaoLogin } = useAuthStore();
  const { colors } = useTheme();
  const router = useRouter();

  const rules = useMemo(() => ({
    phone: compose(required, phoneRule),
    password: compose(required, passwordRule),
  }), []);

  const form = useFormValidation(
    { phone: '', password: '' },
    rules,
  );

  const handleLogin = async () => {
    if (!form.validate()) return;

    setLoading(true);
    try {
      await login(form.values.phone, form.values.password);
      // Navigation handled by root layout gating
    } catch (err: any) {
      const msg = err.response?.data?.error || err?.message || '로그인에 실패했습니다';
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKakaoLogin = async () => {
    setKakaoNotice(null);
    setKakaoLoading(true);

    // WEB: drive OAuth via a FULL-PAGE redirect (no popup — mobile browsers
    // block/break window.open). startKakaoWebLogin navigates the whole tab to
    // Kakao; the return (?code&state) is handled on startup by
    // useKakaoWebCallback. Native keeps the expo-auth-session flow below.
    if (Platform.OS === 'web') {
      const started = startKakaoWebLogin();
      if (!started) {
        // No real Kakao key yet — friendly inline message, no crash, no nav.
        const msg = '카카오 로그인 설정이 준비 중이에요 (키 필요)';
        setKakaoNotice(msg);
        showInfo(msg);
        setKakaoLoading(false);
      }
      // On success the page is leaving (location.assign) — leave the spinner up.
      return;
    }

    try {
      await kakaoLogin();
      // Navigation handled by root layout gating
    } catch (err: any) {
      if (err instanceof KakaoNotConfiguredError) {
        // No real Kakao key yet — friendly inline message, no crash.
        const msg = '카카오 로그인 설정이 준비 중이에요 (키 필요)';
        setKakaoNotice(msg);
        showInfo(msg);
      } else {
        const msg = err.response?.data?.error || err?.message || '카카오 로그인에 실패했습니다';
        showError(msg);
      }
    } finally {
      setKakaoLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer maxWidth={440}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.primary }]}>{Strings.app.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{Strings.auth.login}</Text>

        {/* Primary path for players: Kakao social login. */}
        <Pressable
          onPress={handleKakaoLogin}
          disabled={kakaoLoading}
          accessibilityRole="button"
          accessibilityLabel="카카오로 로그인"
          accessibilityState={{ disabled: kakaoLoading, busy: kakaoLoading }}
          style={({ pressed }) => [
            styles.kakaoButton,
            { backgroundColor: KAKAO_YELLOW, opacity: kakaoLoading ? 0.6 : pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={[styles.kakaoBubble, { color: KAKAO_LABEL }]}>카카오</Text>
          <Text style={[styles.kakaoText, { color: KAKAO_LABEL }]}>
            {kakaoLoading ? '카카오 로그인 중…' : '카카오로 로그인'}
          </Text>
        </Pressable>

        {kakaoNotice ? (
          <Text style={[styles.kakaoNotice, { color: colors.textSecondary }]}>
            {kakaoNotice}
          </Text>
        ) : (
          <Text style={[styles.kakaoHint, { color: colors.textLight }]}>
            회원은 카카오로 간편하게 로그인하세요
          </Text>
        )}

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
          <Text style={[styles.dividerText, { color: colors.textLight }]}>또는</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
        </View>

        {/* Operator / admin path: phone + password (운영자·관리자 전용). */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>운영자/관리자 로그인</Text>

        <View style={styles.form}>
          <Input
            label={Strings.auth.phone}
            placeholder={Strings.auth.phonePlaceholder}
            value={form.values.phone}
            onChangeText={(v) => form.setValue('phone', v)}
            onBlur={() => form.setTouched('phone')}
            error={form.touched.phone ? form.errors.phone : undefined}
            icon="person"
            keyboardType="phone-pad"
            autoCapitalize="none"
          />
          <Input
            label={Strings.auth.password}
            placeholder={Strings.auth.passwordPlaceholder}
            value={form.values.password}
            onChangeText={(v) => form.setValue('password', v)}
            onBlur={() => form.setTouched('password')}
            error={form.touched.password ? form.errors.password : undefined}
            icon="link"
            secureTextEntry
          />
        </View>

        <Button
          title={loading ? Strings.common.loading : Strings.auth.loginButton}
          onPress={handleLogin}
          loading={loading}
          disabled={loading}
          fullWidth
          style={styles.loginButton}
        />

        {/* 회원가입·게스트 참여 제거 — 회원은 카카오 로그인으로만 진입(현장 QR 스캔 출석),
            운영자/관리자는 위 전화번호 로그인. 게스트는 운영자가 운영판에서 직접 추가. */}
      </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.subtitle1,
    textAlign: 'center',
    marginBottom: spacing.xxxl,
  },
  form: {
    gap: spacing.lg,
    marginBottom: spacing.xxl,
  },
  kakaoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.xxl,
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  kakaoBubble: {
    ...typography.caption,
    fontWeight: '700',
    borderRadius: radius.sm,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  kakaoText: {
    ...typography.button,
    fontSize: 16,
  },
  kakaoHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  kakaoNotice: {
    ...typography.body2,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  sectionLabel: {
    ...typography.subtitle2,
    marginBottom: spacing.md,
  },
  loginButton: {
    marginTop: spacing.sm,
  },
  guestButton: {
    marginTop: spacing.xl,
  },
  linkText: {
    ...typography.body2,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    ...typography.caption,
  },
  guestHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

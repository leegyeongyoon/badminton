import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme';
import { useFormValidation } from '../../hooks/useFormValidation';
import {
  compose,
  required,
  phone as phoneRule,
  password as passwordRule,
  minLength,
} from '../../utils/validation';
import { typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showError } from '../../utils/feedback';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

/**
 * 운영자(모임 관리자) 가입 신청 화면.
 *
 * 일반 회원은 카카오 로그인 + 현장 QR 출석으로 들어오므로, 이 화면은 "모임을
 * 운영하려는 사람"이 계정을 만들고 최고관리자 승인을 받기 위한 신청서다. 이름·연락처·
 * 비밀번호에 더해 운영할 모임 이름(필수)과 활동 지역/장소(선택)를 받는다. 제출하면
 * 계정이 PENDING 으로 생성되고, 루트 게이트가 곧바로 승인 대기 화면(/operator-pending)
 * 으로 보낸다. 승인 전까지는 앱을 사용할 수 없다.
 */
export default function RegisterScreen() {
  const [loading, setLoading] = useState(false);
  const { registerOperator } = useAuthStore();
  const { colors } = useTheme();

  const rules = useMemo(() => ({
    name: compose(required, minLength(2)),
    phone: compose(required, phoneRule),
    password: compose(required, passwordRule),
    clubName: compose(required, minLength(1)),
  }), []);

  const form = useFormValidation(
    { name: '', phone: '', password: '', clubName: '', region: '' },
    rules,
  );

  const handleRegister = async () => {
    if (!form.validate()) return;

    setLoading(true);
    try {
      await registerOperator({
        phone: form.values.phone,
        password: form.values.password,
        name: form.values.name,
        clubName: form.values.clubName.trim(),
        region: form.values.region.trim() || undefined,
      });
      // 이후 이동은 루트 레이아웃 게이트가 처리(→ /operator-pending).
    } catch (err: any) {
      showError(err.response?.data?.error || '가입 신청에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.primary }]}>운영자 가입 신청</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          모임을 운영하시려면 신청 후 승인을 받아야 해요
        </Text>

        <View style={styles.form}>
          <Input
            label={Strings.auth.name}
            placeholder={Strings.auth.namePlaceholder}
            value={form.values.name}
            onChangeText={(v) => form.setValue('name', v)}
            onBlur={() => form.setTouched('name')}
            error={form.touched.name ? form.errors.name : undefined}
            icon="person"
          />
          <Input
            label={Strings.auth.phone}
            placeholder={Strings.auth.phonePlaceholder}
            value={form.values.phone}
            onChangeText={(v) => form.setValue('phone', v)}
            onBlur={() => form.setTouched('phone')}
            error={form.touched.phone ? form.errors.phone : undefined}
            icon="people"
            keyboardType="phone-pad"
            autoCapitalize="none"
            maxLength={11}
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
          <Input
            label="운영할 모임 이름"
            placeholder="예: 터닝포인트 배드민턴"
            value={form.values.clubName}
            onChangeText={(v) => form.setValue('clubName', v)}
            onBlur={() => form.setTouched('clubName')}
            error={form.touched.clubName ? form.errors.clubName : undefined}
            icon="board"
            maxLength={40}
          />
          <Input
            label="활동 지역/장소 (선택)"
            placeholder="예: 서울 강남 · ○○체육관"
            value={form.values.region}
            onChangeText={(v) => form.setValue('region', v)}
            icon="map"
            maxLength={40}
          />
        </View>

        <Button
          title={loading ? Strings.common.loading : '가입 신청'}
          onPress={handleRegister}
          loading={loading}
          disabled={loading}
          fullWidth
          style={styles.registerButton}
        />

        <View style={[styles.noticeBox, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            신청하면 최고관리자 승인 후 이용할 수 있어요. 승인 전까지는 대기 화면이 표시됩니다.
          </Text>
        </View>

        <Link href="/(auth)/login" asChild>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {Strings.auth.goToLogin}
          </Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
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
  registerButton: {
    marginTop: spacing.sm,
  },
  noticeBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: {
    ...typography.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
  linkText: {
    ...typography.body2,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme';
import { useFormValidation } from '../../hooks/useFormValidation';
import { compose, required, phone as phoneRule, password as passwordRule } from '../../utils/validation';
import { typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showError } from '../../utils/feedback';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { colors } = useTheme();

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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.primary }]}>{Strings.app.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{Strings.auth.login}</Text>

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

        <Link href="/(auth)/register" asChild>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {Strings.auth.goToRegister}
          </Text>
        </Link>
      </View>
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
  loginButton: {
    marginTop: spacing.sm,
  },
  linkText: {
    ...typography.body2,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

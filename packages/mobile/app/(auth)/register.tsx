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
import {
  compose,
  required,
  phone as phoneRule,
  password as passwordRule,
  minLength,
} from '../../utils/validation';
import { typography, spacing } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showError } from '../../utils/feedback';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export default function RegisterScreen() {
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();
  const { colors } = useTheme();

  const rules = useMemo(() => ({
    name: compose(required, minLength(2)),
    phone: compose(required, phoneRule),
    password: compose(required, passwordRule),
  }), []);

  const form = useFormValidation(
    { name: '', phone: '', password: '' },
    rules,
  );

  const handleRegister = async () => {
    if (!form.validate()) return;

    setLoading(true);
    try {
      await register(form.values.phone, form.values.password, form.values.name);
      // Navigation handled by root layout gating
    } catch (err: any) {
      showError(err.response?.data?.error || '회원가입에 실패했습니다');
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
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{Strings.auth.register}</Text>

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
        </View>

        <Button
          title={loading ? Strings.common.loading : Strings.auth.registerButton}
          onPress={handleRegister}
          loading={loading}
          disabled={loading}
          fullWidth
          style={styles.registerButton}
        />

        <Link href="/(auth)/login" asChild>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {Strings.auth.goToLogin}
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
  registerButton: {
    marginTop: spacing.sm,
  },
  linkText: {
    ...typography.body2,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

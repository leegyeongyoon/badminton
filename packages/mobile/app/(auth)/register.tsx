import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

export default function RegisterScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();

  const handleRegister = async () => {
    if (!name.trim()) {
      showAlert('알림', '이름을 입력해주세요');
      return;
    }
    if (!/^01[0-9]{8,9}$/.test(phone)) {
      showAlert('알림', '올바른 전화번호를 입력해주세요 (예: 01012345678)');
      return;
    }
    if (password.length < 6) {
      showAlert('알림', '비밀번호는 6자 이상이어야 합니다');
      return;
    }
    setLoading(true);
    try {
      await register(phone, password, name);
      // Navigation handled by root layout gating
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '회원가입에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{Strings.app.name}</Text>
        <Text style={styles.subtitle}>{Strings.auth.register}</Text>

        <TextInput
          style={styles.input}
          placeholder={Strings.auth.namePlaceholder}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder={Strings.auth.phonePlaceholder}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
          maxLength={11}
        />
        <TextInput
          style={styles.input}
          placeholder="비밀번호 (6자 이상)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {password.length > 0 && password.length < 6 && (
          <Text style={styles.hintText}>비밀번호는 6자 이상이어야 합니다</Text>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? Strings.common.loading : Strings.auth.registerButton}
          </Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkText}>{Strings.auth.goToLogin}</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    color: Colors.text,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    color: Colors.primary,
    fontSize: 14,
  },
  hintText: {
    fontSize: 12,
    color: Colors.danger,
    marginTop: -8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
});

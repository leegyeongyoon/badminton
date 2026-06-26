import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { SKILL_LEVELS, getSkillMeta, type SkillLevel } from '../constants/skill';
import { GENDER_META, type Gender } from '../constants/gender';
import { showError } from '../utils/feedback';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { ScreenContainer } from '../components/ui/ScreenContainer';

// ─────────────────────────────────────────────────────────
// 신규 카카오 가입자 프로필 설정 — 이름(필수) + 급수(필수) + 성별(필수).
//  • POST /auth/complete-profile → 이름/급수/성별 저장
//  • 제출 후 authStore.completeProfile 로 로컬 user 갱신 → 게이트가 홈으로 보냄
//    (대기 중인 모임 초대코드가 있으면 게이트가 자동 가입까지 처리)
//  • 카카오는 성별을 주지 않으므로(닉네임만) 여기서 한 번 필수로 받는다.
//    성별은 ♂/♀ 마커 + 혼복/남복 매칭에 쓰이므로 게이트가 강제한다.
// ─────────────────────────────────────────────────────────

export default function ProfileSetupScreen() {
  const { user, completeProfile } = useAuthStore();
  const { colors } = useTheme();

  // Prefill with the current name unless it's the Kakao placeholder.
  const initialName = user?.name && user.name !== '카카오회원' ? user.name : '';
  const [name, setName] = useState(initialName);
  const [skill, setSkill] = useState<SkillLevel | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const trimmedName = name.trim();
  const nameError = touched && trimmedName.length === 0 ? '이름을 입력하세요' : undefined;
  // 급수 is REQUIRED — it's captured once here and never re-prompted, so the
  // 시작하기 button stays disabled until 이름·급수·성별 are all provided.
  const skillError = touched && !skill ? '급수를 선택하세요' : undefined;
  // 성별 is REQUIRED — the gate enforces it (카카오는 성별을 주지 않음).
  const genderError = touched && !gender ? '성별을 선택하세요' : undefined;
  const canSubmit = trimmedName.length > 0 && !!skill && !!gender;

  const handleSubmit = async () => {
    setTouched(true);
    if (trimmedName.length === 0 || !skill || !gender) return;

    setLoading(true);
    try {
      await completeProfile({
        name: trimmedName,
        skillLevel: skill,
        gender,
      });
      // Navigation handled by the root layout gate (→ home, or auto-join a
      // pending club invite then into that club).
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || '프로필 저장에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer maxWidth={480}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>프로필 설정</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          모임에서 보여질 이름·급수·성별을 입력해 주세요
        </Text>

        {/* 이름 (필수) */}
        <View style={styles.field}>
          <Input
            label="이름"
            placeholder="이름을 입력하세요"
            value={name}
            onChangeText={setName}
            onBlur={() => setTouched(true)}
            error={nameError}
            icon="person"
            maxLength={20}
            accessibilityLabel="이름"
          />
        </View>

        {/* 급수 (필수) — 기준을 보고 본인에 맞게 선택 */}
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>급수 (필수)</Text>
          <View style={{ gap: 8 }}>
            {SKILL_LEVELS.map((lv) => {
              const meta = getSkillMeta(lv);
              const selected = skill === lv;
              return (
                <Pressable
                  key={lv}
                  onPress={() => setSkill(selected ? null : lv)}
                  accessibilityRole="button"
                  accessibilityLabel={`급수 ${lv} ${meta.description}`}
                  accessibilityState={{ selected }}
                  style={[
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? meta.color : colors.border,
                      backgroundColor: selected ? meta.color + '14' : colors.surface,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor: meta.color,
                    }}
                  >
                    <Text style={{ color: meta.color, fontWeight: '900', fontSize: 15 }}>{lv}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                      {lv}급
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 1 }}>
                      {meta.description}
                    </Text>
                  </View>
                  {selected && (
                    <Text style={{ color: meta.color, fontWeight: '900', fontSize: 16 }}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          {skillError && (
            <Text style={[styles.errorText, { color: colors.danger }]} accessibilityLiveRegion="polite">
              {skillError}
            </Text>
          )}
        </View>

        {/* 성별 (필수) — ♂/♀ 마커 + 혼복/남복 매칭에 사용 */}
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>성별 (필수)</Text>
          <View style={styles.genderRow}>
            {(['M', 'F'] as Gender[]).map((g) => {
              const meta = GENDER_META[g];
              const selected = gender === g;
              return (
                <Pressable
                  key={g}
                  onPress={() => setGender(selected ? null : g)}
                  accessibilityRole="button"
                  accessibilityLabel={`성별 ${meta.label}`}
                  accessibilityState={{ selected }}
                  style={[
                    styles.genderChip,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    selected && { borderColor: meta.color, backgroundColor: meta.bg },
                  ]}
                >
                  <Text style={[styles.genderSymbol, { color: selected ? meta.color : colors.textSecondary }]}>
                    {meta.symbol}
                  </Text>
                  <Text style={[styles.genderLabel, { color: selected ? meta.color : colors.text }]}>
                    {meta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {genderError && (
            <Text style={[styles.errorText, { color: colors.danger }]} accessibilityLiveRegion="polite">
              {genderError}
            </Text>
          )}
        </View>

        <Button
          title={loading ? '저장 중…' : '시작하기'}
          onPress={handleSubmit}
          loading={loading}
          disabled={loading || !canSubmit}
          fullWidth
          style={styles.submitButton}
          accessibilityLabel="프로필 저장하고 시작하기"
        />
      </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.xxl,
    paddingTop: spacing.xxxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body2,
    marginBottom: spacing.md,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.caption,
  },
  errorText: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  skillChip: {
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 64,
  },
  skillChipLevel: {
    ...typography.subtitle1,
    fontWeight: '800',
  },
  skillChipLabel: {
    ...typography.caption,
    marginTop: 2,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  genderChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: spacing.mlg,
  },
  genderSymbol: {
    fontSize: 18,
    fontWeight: '700',
  },
  genderLabel: {
    ...typography.subtitle2,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
});

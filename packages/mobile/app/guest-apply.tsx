import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { alpha } from '../utils/color';
import { SKILL_LEVELS, SKILL_META, type SkillLevel } from '../constants/skill';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────
// 게스트 사전 신청(공개 페이지) — /guest-apply?code=<초대코드>
// 비회원이 로그인 없이: 모임 확인 → 이름·연락처 입력 → 신청 → 입금 안내 + 앱 설치.
// ─────────────────────────────────────────────────────────────

interface ClubInfo { clubId: string; clubName: string; guestFee: number | null; accountInfo: string | null }
interface ApplyResult { id: string; clubName: string; feeAmount: number | null; accountInfo: string | null; message: string }

const APP_STORE_URL = 'https://apps.apple.com/app/id6788656869';

// 오늘부터 7일치 방문 희망일 후보 — {value: 'YYYY-MM-DD', label: '8/2 (토)'}.
function upcomingDates(): { value: string; label: string }[] {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ value, label: `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})` });
  }
  return out;
}

export default function GuestApply() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [club, setClub] = useState<ClubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [skill, setSkill] = useState<SkillLevel | null>(null);
  const [gender, setGender] = useState<'M' | 'F' | null>(null);
  const [visitDate, setVisitDate] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dates = upcomingDates();

  useEffect(() => {
    const c = typeof code === 'string' ? code.trim() : '';
    if (!c) { setLoading(false); return; }
    api.get(`/guest-apply/${encodeURIComponent(c)}`, { _silent: true } as any)
      .then(({ data }) => setClub(data))
      .catch(() => setClub(null))
      .finally(() => setLoading(false));
  }, [code]);

  const submit = async () => {
    if (!club || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post(`/guest-apply/${encodeURIComponent(String(code))}`, {
        name: name.trim(),
        skillLevel: skill ?? undefined,
        gender: gender ?? undefined,
        visitDate: visitDate ?? undefined,
        phone: phone.trim() || undefined,
        note: note.trim() || undefined,
      }, { _silent: true } as any);
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.error || '신청에 실패했어요. 입력을 확인해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const openStore = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.open(APP_STORE_URL, '_blank'); } catch { /* noop */ }
    }
  };

  // 핵심 항목: 이름·급수·성별·희망일. 연락처는 선택(입력 시에만 형식 검사는 서버에서).
  const canSubmit = name.trim().length >= 1 && !!skill && !!gender && !!visitDate;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + 60 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.brand, { color: colors.primary }]}>콕고</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !club ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.title, { color: colors.text }]}>모임을 찾을 수 없어요</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>초대 링크를 다시 확인해 주세요.</Text>
        </View>
      ) : result ? (
        // ── 신청 완료: 입금 안내 ──
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={[styles.okBadge, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
            <Text style={[styles.okBadgeText, { color: colors.secondary }]}>신청 접수 ✓</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{result.clubName} 게스트 신청 완료</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>{result.message}</Text>

          {result.feeAmount != null && (
            <View style={[styles.payBox, { backgroundColor: alpha(colors.primary, 0.08) }]}>
              <Text style={[styles.payLabel, { color: colors.textSecondary }]}>게스트비</Text>
              <Text style={[styles.payAmount, { color: colors.primary }]}>{result.feeAmount.toLocaleString()}원</Text>
              {result.accountInfo ? (
                <>
                  <Text style={[styles.payLabel, { color: colors.textSecondary, marginTop: spacing.md }]}>입금 계좌</Text>
                  <Text style={[styles.payAccount, { color: colors.text }]}>{result.accountInfo}</Text>
                </>
              ) : (
                <Text style={[styles.desc, { color: colors.textLight, marginTop: spacing.sm }]}>계좌는 운영자가 문자로 안내드릴 거예요.</Text>
              )}
            </View>
          )}
          <Text style={[styles.desc, { color: colors.textSecondary }]}>입금이 확인되면 운영자가 확정 처리해 드려요.</Text>

          <Pressable onPress={openStore} style={({ pressed }) => [styles.storeBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}>
            <Text style={styles.storeBtnText}>콕고 앱 설치하고 게임 현황 보기</Text>
          </Pressable>
        </View>
      ) : (
        // ── 신청 폼 ──
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.title, { color: colors.text }]}>{club.clubName}</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>
            게스트 신청서를 작성해 주세요.{club.guestFee != null ? ` 게스트비는 ${club.guestFee.toLocaleString()}원이에요.` : ''}
          </Text>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>이름</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={name}
            onChangeText={setName}
            placeholder="홍길동"
            placeholderTextColor={colors.textLight}
            maxLength={20}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>급수</Text>
          <View style={styles.chipRow}>
            {SKILL_LEVELS.map((lv) => {
              const meta = SKILL_META[lv];
              const active = skill === lv;
              return (
                <Pressable
                  key={lv}
                  onPress={() => setSkill(lv)}
                  style={[styles.skillChip, active ? { backgroundColor: meta.color } : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border }]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{lv}</Text>
                </Pressable>
              );
            })}
          </View>
          {skill && <Text style={[styles.chipHint, { color: SKILL_META[skill].color }]}>{skill} · {SKILL_META[skill].description}</Text>}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>성별</Text>
          <View style={styles.chipRow}>
            {([{ k: 'M', label: '남' }, { k: 'F', label: '여' }] as const).map((g) => {
              const active = gender === g.k;
              return (
                <Pressable
                  key={g.k}
                  onPress={() => setGender(g.k)}
                  style={[styles.genderChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border }]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>참석 희망일</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dates.map((d) => {
              const active = visitDate === d.value;
              return (
                <Pressable
                  key={d.value}
                  onPress={() => setVisitDate(d.value)}
                  style={[styles.dateChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border }]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>연락처 (선택)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={phone}
            onChangeText={setPhone}
            placeholder="01012345678"
            placeholderTextColor={colors.textLight}
            keyboardType="phone-pad"
            maxLength={13}
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>한마디 (선택)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={note}
            onChangeText={setNote}
            placeholder="예: C조입니다, 이번 주 토요일 참석 희망"
            placeholderTextColor={colors.textLight}
            maxLength={200}
          />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={!canSubmit || submitting}
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: canSubmit ? colors.primary : colors.surface3 },
              (pressed || submitting) && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.submitBtnText, { color: canSubmit ? '#fff' : colors.textLight }]}>
              {submitting ? '신청 중…' : '게스트 신청하기'}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brand: { ...typography.h2, textAlign: 'center', marginBottom: spacing.lg },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  card: { borderRadius: radius.card, padding: spacing.xl },
  title: { ...typography.h3, marginBottom: spacing.sm },
  desc: { ...typography.body2, lineHeight: 20, marginBottom: spacing.md },
  fieldLabel: { ...typography.caption, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { ...typography.body1, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  error: { ...typography.caption, fontWeight: '700', marginTop: spacing.sm },
  submitBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', marginTop: spacing.lg },
  submitBtnText: { ...typography.button },
  okBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginBottom: spacing.md },
  okBadgeText: { fontSize: 12, fontWeight: '900' },
  payBox: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  payLabel: { ...typography.caption, fontWeight: '700' },
  payAmount: { ...typography.h2, marginTop: 2 },
  payAccount: { ...typography.subtitle1, marginTop: 2 },
  storeBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', marginTop: spacing.sm },
  storeBtnText: { ...typography.button, color: '#fff' },

  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', paddingVertical: 2 },
  skillChip: { width: 44, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  skillChipText: { ...typography.body2, fontWeight: '900' },
  genderChip: { width: 64, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateChip: { paddingHorizontal: spacing.md, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  chipHint: { ...typography.caption, fontWeight: '800', marginTop: spacing.xs },
});

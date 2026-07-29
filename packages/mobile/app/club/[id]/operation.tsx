import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing, radius } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { showSuccess } from '../../../utils/feedback';
import { clubOperationApi, type WeeklySlot } from '../../../services/lab';

// ─────────────────────────────────────────────────────────────
// 모임 운영 정보(운영진) — ① 정기 운동 일정(요일·시간) ② 게스트 신청 정책.
// 운동 요일은 게스트 신청 가능일 계산의 기준이 된다(요일 외 날짜는 신청 불가).
// 1차 구현: 요일 다중 선택 + 공통 시작/종료 시간 1세트(요일별 개별 시간은 후속).
// ─────────────────────────────────────────────────────────────

const DAYS = [
  { day: 1, label: '월' }, { day: 2, label: '화' }, { day: 3, label: '수' },
  { day: 4, label: '목' }, { day: 5, label: '금' }, { day: 6, label: '토' }, { day: 0, label: '일' },
];

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const num = (s: string): number | null => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n < 0 ? null : n;
};

export default function ClubOperation() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clubName, setClubName] = useState('');
  // 운동 일정
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [start, setStart] = useState('20:00');
  const [end, setEnd] = useState('22:00');
  // 게스트 신청 정책
  const [applyEnabled, setApplyEnabled] = useState(true);
  const [deadlineHours, setDeadlineHours] = useState('');
  const [maxGuests, setMaxGuests] = useState('');

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const c = await clubOperationApi.get(clubId);
      setClubName(c.clubName);
      setSelectedDays([...new Set(c.weeklySchedule.map((s) => s.day))]);
      if (c.weeklySchedule[0]) {
        setStart(c.weeklySchedule[0].start);
        setEnd(c.weeklySchedule[0].end);
      }
      setApplyEnabled(c.guestApplyEnabled);
      setDeadlineHours(c.guestApplyDeadlineHours != null ? String(c.guestApplyDeadlineHours) : '');
      setMaxGuests(c.maxGuestsPerDay != null ? String(c.maxGuestsPerDay) : '');
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!clubId || saving) return;
    const s = HHMM.test(start) ? start : '20:00';
    const e = HHMM.test(end) ? end : '22:00';
    const weeklySchedule: WeeklySlot[] = selectedDays.map((day) => ({ day, start: s, end: e }));
    setSaving(true);
    try {
      await clubOperationApi.set(clubId, {
        weeklySchedule,
        guestApplyEnabled: applyEnabled,
        guestApplyDeadlineHours: num(deadlineHours),
        maxGuestsPerDay: num(maxGuests),
      });
      showSuccess('저장했어요');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: number) =>
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {clubName ? `${clubName} · 운영 정보` : '운영 정보'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled">
          {/* 정기 운동 일정 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>정기 운동 일정</Text>
            <Text style={[styles.cardHint, { color: colors.textLight }]}>
              운동 요일을 정하면 게스트 신청도 그 요일에만 받아요
            </Text>
            <View style={styles.dayRow}>
              {DAYS.map((d) => {
                const active = selectedDays.includes(d.day);
                return (
                  <Pressable
                    key={d.day}
                    onPress={() => toggleDay(d.day)}
                    style={[styles.dayChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border }]}
                  >
                    <Text style={[styles.dayChipText, { color: active ? '#fff' : colors.textSecondary }]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>시작</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
                  value={start}
                  onChangeText={setStart}
                  placeholder="20:00"
                  placeholderTextColor={colors.textLight}
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>종료</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
                  value={end}
                  onChangeText={setEnd}
                  placeholder="22:00"
                  placeholderTextColor={colors.textLight}
                  maxLength={5}
                />
              </View>
            </View>
            {selectedDays.length === 0 && (
              <Text style={[styles.warn, { color: colors.textLight }]}>* 요일 미선택 = 일정 안내 없음, 게스트 신청은 아무 날짜나 가능</Text>
            )}
          </View>

          {/* 게스트 신청 정책 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>게스트 신청 받기</Text>
                <Text style={[styles.cardHint, { color: colors.textLight }]}>
                  {applyEnabled ? '신청을 받고 있어요' : '꺼짐 — 신청 페이지에 "받지 않음" 안내'}
                </Text>
              </View>
              <Switch
                value={applyEnabled}
                onValueChange={setApplyEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: spacing.md }]}>신청 마감 (운동 시작 몇 시간 전, 선택)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
              value={deadlineHours}
              onChangeText={setDeadlineHours}
              placeholder="예: 6 (비우면 시작 전까지)"
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: spacing.md }]}>하루 게스트 정원 (선택)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
              value={maxGuests}
              onChangeText={setMaxGuests}
              placeholder="예: 4 (비우면 무제한)"
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>

          <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary }, (saving || pressed) && { opacity: 0.85 }]}>
            <Text style={styles.saveText}>{saving ? '저장 중…' : '저장'}</Text>
          </Pressable>
          <Text style={[styles.warn, { color: colors.textLight }]}>
            * 정원이 차거나 마감 시간이 지나면 그 날짜는 신청 화면에서 자동으로 "마감" 처리돼요.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { ...typography.subtitle1 },
  cardHint: { ...typography.caption, marginTop: 2, marginBottom: spacing.sm },
  dayRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md },
  dayChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayChipText: { ...typography.body2, fontWeight: '900' },
  timeRow: { flexDirection: 'row', gap: spacing.md },
  fieldLabel: { ...typography.caption, fontWeight: '700', marginBottom: spacing.xs },
  input: { ...typography.body1, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  saveBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', marginBottom: spacing.sm },
  saveText: { ...typography.button, color: '#fff' },
  warn: { ...typography.caption, lineHeight: 16, marginBottom: spacing.sm },
});

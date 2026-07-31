import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../../hooks/useTheme';
import { typography, spacing } from '../../../../constants/theme';
import { BackButton } from '../../../../components/ui/BackButton';
import { lessonDetailApi, type LessonDetail, type LessonStudentRow, type LessonBilling } from '../../../../services/coach';
import { absolutizeUploadUrl } from '../../../../services/upload';
import { showSuccess } from '../../../../utils/feedback';
import { COACH_MARKET_ENABLED } from '../../../../constants/features';
// (대기 풀기·정산 요약도 이 화면에서 처리)

// ─────────────────────────────────────────────────────────────
// 레슨 상세(운영진 + 담당 코치) — 코치 헤더 · 수강생 로스터 · 회차 출석.
// 숨고식: 레슨 안에 레슨생이 존재하고 상태(수강중/휴식/종료)와 회차 출석을 관리한다.
// ─────────────────────────────────────────────────────────────

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const ENROLL_STATES = [
  { key: 'ACTIVE', label: '수강중' },
  { key: 'PAUSED', label: '휴식' },
  { key: 'ENDED', label: '종료' },
] as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LessonDetailScreen() {
  const { id: clubId, offerId } = useLocalSearchParams<{ id: string; offerId: string }>();
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [billing, setBilling] = useState<LessonBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'roster' | 'attendance'>('roster');

  // 로스터 편집(펼침) 상태
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // 출석
  const [date, setDate] = useState(() => ymd(new Date()));
  const [attend, setAttend] = useState<Record<string, boolean>>({});
  const [attendLoading, setAttendLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubId || !offerId) return;
    try {
      setDetail(await lessonDetailApi.get(clubId, offerId));
      lessonDetailApi.billing(clubId, offerId).then(setBilling).catch(() => {});
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId, offerId]);
  useEffect(() => { load(); }, [load]);

  const loadAttendance = useCallback(async () => {
    if (!clubId || !offerId) return;
    setAttendLoading(true);
    try {
      const rows = await lessonDetailApi.attendance(clubId, offerId, date);
      const map: Record<string, boolean> = {};
      rows.forEach((r) => { map[r.applicationId] = r.present; });
      setAttend(map);
    } catch {
      /* noop */
    } finally {
      setAttendLoading(false);
    }
  }, [clubId, offerId, date]);
  useEffect(() => {
    if (tab === 'attendance') loadAttendance();
  }, [tab, loadAttendance]);

  const shiftDate = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(ymd(d));
  };

  const toggleAttend = async (appId: string) => {
    if (!clubId || !offerId) return;
    const next = !attend[appId];
    setAttend((prev) => ({ ...prev, [appId]: next }));
    try {
      await lessonDetailApi.setAttendance(clubId, offerId, date, [{ applicationId: appId, present: next }]);
    } catch {
      setAttend((prev) => ({ ...prev, [appId]: !next }));
    }
  };

  const promote = async (appId: string, name: string) => {
    if (!clubId || !offerId) return;
    try {
      await lessonDetailApi.promoteWaitlist(clubId, offerId, appId);
      showSuccess(`${name}님 대기를 풀었어요 — 확정 대기로 올라갔어요`);
      await load();
    } catch {
      /* 토스트는 인터셉터 */
    }
  };

  const setEnroll = async (student: LessonStudentRow, enrollState: string) => {
    if (!clubId || !offerId || student.enrollState === enrollState) return;
    setDetail((prev) =>
      prev ? { ...prev, roster: prev.roster.map((s) => (s.id === student.id ? { ...s, enrollState } : s)) } : prev,
    );
    try {
      await lessonDetailApi.updateStudent(clubId, offerId, student.id, { enrollState });
      if (enrollState === 'ENDED' && (detail?.waitlist.length ?? 0) > 0) {
        showSuccess('자리가 생겨 대기 1순위에게 알림을 보냈어요');
      }
    } catch {
      load();
    }
  };

  const saveNote = async (student: LessonStudentRow) => {
    if (!clubId || !offerId) return;
    try {
      await lessonDetailApi.updateStudent(clubId, offerId, student.id, { note: noteDraft.trim() || null });
      setDetail((prev) =>
        prev ? { ...prev, roster: prev.roster.map((s) => (s.id === student.id ? { ...s, note: noteDraft.trim() || null } : s)) } : prev,
      );
      setOpenStudentId(null);
      showSuccess('메모를 저장했어요');
    } catch {
      /* noop */
    }
  };

  const confirmed = useMemo(() => (detail?.roster ?? []).filter((s) => s.status === 'CONFIRMED'), [detail]);
  const pending = useMemo(() => (detail?.roster ?? []).filter((s) => s.status === 'PENDING'), [detail]);
  const attendTargets = useMemo(() => confirmed.filter((s) => s.enrollState !== 'ENDED'), [confirmed]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: spacing.md }}><BackButton /></View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...typography.body1, color: colors.textSecondary }}>레슨을 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  const { offer } = detail;
  const photo = absolutizeUploadUrl(offer.coachPhotoUrl);
  const dateObj = new Date(`${date}T12:00:00`);
  const isLessonDay = offer.days.includes(dateObj.getDay());
  const presentCount = attendTargets.filter((s) => attend[s.id]).length;

  const renderStatusChips = (student: LessonStudentRow) => (
    <View style={styles.enrollChips}>
      {ENROLL_STATES.map((st) => {
        const on = student.enrollState === st.key;
        return (
          <Pressable
            key={st.key}
            onPress={() => setEnroll(student, st.key)}
            style={[styles.enrollChip, { backgroundColor: on ? colors.primary : colors.background, borderColor: on ? colors.primary : colors.border }]}
          >
            <Text style={[styles.enrollChipText, { color: on ? '#fff' : colors.textSecondary }]}>{st.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{offer.clubName} 레슨</Text>
          <Text style={[styles.sub, { color: colors.textLight }]} numberOfLines={1}>{offer.summary}</Text>
        </View>
        {detail.isCoach && (
          <View style={[styles.coachTag, { backgroundColor: colors.primary + '16' }]}>
            <Text style={[styles.coachTagText, { color: colors.primary }]}>담당 코치</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* 코치 헤더 */}
        <Pressable
          disabled={!offer.coachProfileId}
          onPress={() => offer.coachProfileId && router.push(`/coach/${offer.coachProfileId}` as never)}
          style={[styles.coachCard, { backgroundColor: colors.surface }, shadows.md]}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={styles.coachPhoto} />
          ) : (
            <View style={[styles.coachPhoto, styles.coachPhotoFallback, { backgroundColor: colors.primary + '14' }]}>
              <Text style={[styles.coachInitial, { color: colors.primary }]}>{offer.coachName.slice(0, 1)}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.coachNameRow}>
              <Text style={[styles.coachName, { color: colors.text }]} numberOfLines={1}>{offer.coachName} 코치</Text>
              {offer.coachCertified && (
                <View style={[styles.certBadge, { backgroundColor: colors.primary + '16' }]}>
                  <Ionicons name="checkmark-circle" size={11} color={colors.primary} />
                  <Text style={[styles.certText, { color: colors.primary }]}>인증</Text>
                </View>
              )}
            </View>
            {!!offer.coachIntro && (
              <Text style={[styles.coachIntro, { color: colors.textSecondary }]} numberOfLines={1}>{offer.coachIntro}</Text>
            )}
            <Text style={[styles.coachMeta, { color: colors.textLight }]}>
              {offer.summary}{offer.fee != null ? ` · 월 ${offer.fee.toLocaleString()}원` : ''}
              {offer.capacity ? ` · 정원 ${offer.capacity}명` : ''}
            </Text>
          </View>
          {!!offer.coachProfileId && <Ionicons name="chevron-forward" size={18} color={colors.textLight} />}
        </Pressable>

        {/* 이번 달 정산 요약(운영자·코치) — PG 이전 예상치 */}
        {COACH_MARKET_ENABLED && billing && billing.fee != null && (
          <View style={[styles.billingStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.billingText, { color: colors.textSecondary }]}>
              수강 {billing.activeStudents}명 · 수납 {billing.paidCount}/{billing.activeStudents} · 총 {billing.gross.toLocaleString()}원
            </Text>
            <Text style={[styles.billingPayout, { color: colors.text }]}>
              코치 지급 예정 {billing.coachPayout.toLocaleString()}원
            </Text>
          </View>
        )}

        {/* 탭: 수강생 | 출석 */}
        <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {([
            { key: 'roster', label: `수강생 ${confirmed.length}` },
            { key: 'attendance', label: '출석 체크' },
          ] as const).map((t) => {
            const on = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.segmentBtn, on && { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.segmentText, { color: on ? '#fff' : colors.textSecondary }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'roster' ? (
          <>
            {confirmed.length === 0 && pending.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="people-outline" size={32} color={colors.textLight} />
                <Text style={[styles.emptyText, { color: colors.textLight }]}>아직 수강생이 없어요{'\n'}회원 신청이 확정되면 여기에 쌓여요</Text>
              </View>
            )}

            {confirmed.map((s) => {
              const open = openStudentId === s.id;
              return (
                <View key={s.id} style={[styles.studentCard, { backgroundColor: colors.surface }, shadows.md]}>
                  <Pressable
                    onPress={() => {
                      setOpenStudentId(open ? null : s.id);
                      setNoteDraft(s.note ?? '');
                    }}
                    style={styles.studentHead}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.studentNameRow}>
                        <Text style={[styles.studentName, { color: colors.text }]} numberOfLines={1}>{s.name}</Text>
                        {s.enrollState !== 'ACTIVE' && (
                          <Text style={[styles.stateTag, { color: colors.textLight }]}>
                            {ENROLL_STATES.find((e) => e.key === s.enrollState)?.label}
                          </Text>
                        )}
                        {s.feePaid ? (
                          <View style={[styles.feeBadge, { backgroundColor: colors.secondary + '18' }]}>
                            <Text style={[styles.feeBadgeText, { color: colors.secondary }]}>입금 확인</Text>
                          </View>
                        ) : (
                          <View style={[styles.feeBadge, { backgroundColor: colors.warning + '20' }]}>
                            <Text style={[styles.feeBadgeText, { color: colors.warning }]}>입금 전</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.studentMeta, { color: colors.textLight }]} numberOfLines={1}>
                        출석 {s.attendCount}회{s.phone ? ` · ${s.phone}` : ''}{s.note ? ` · ${s.note}` : ''}
                      </Text>
                    </View>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textLight} />
                  </Pressable>

                  {open && (
                    <View style={[styles.studentBody, { borderTopColor: colors.border }]}>
                      {renderStatusChips(s)}
                      <View style={styles.noteRow}>
                        <TextInput
                          style={[styles.noteInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
                          value={noteDraft}
                          onChangeText={setNoteDraft}
                          placeholder="메모 (레슨 시간, 특이사항 등)"
                          placeholderTextColor={colors.textLight}
                          maxLength={200}
                        />
                        <Pressable onPress={() => saveNote(s)} style={[styles.noteSave, { backgroundColor: colors.primary }]}>
                          <Text style={styles.noteSaveText}>저장</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            {(detail.waitlist.length > 0) && (
              <>
                <Text style={[styles.pendingLabel, { color: colors.textLight }]}>대기열 {detail.waitlist.length}명 — 자리가 나면 순번대로 풀어주세요</Text>
                {detail.waitlist.map((w) => (
                  <View key={w.id} style={[styles.waitCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.waitRank, { backgroundColor: colors.warning + '1A' }]}>
                      <Text style={[styles.waitRankText, { color: colors.warning }]}>{w.rank}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.studentName, { color: colors.text }]} numberOfLines={1}>{w.name}</Text>
                      <Text style={[styles.studentMeta, { color: colors.textLight }]}>
                        대기 {w.rank}번{w.phone ? ` · ${w.phone}` : ''}
                      </Text>
                    </View>
                    <Pressable onPress={() => promote(w.id, w.name)} style={[styles.promoteBtn, { backgroundColor: colors.primary }]}>
                      <Text style={styles.promoteBtnText}>대기 풀기</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text style={[styles.pendingLabel, { color: colors.textLight }]}>확정 대기 {pending.length}명</Text>
                {pending.map((s) => (
                  <View key={s.id} style={[styles.studentCard, styles.pendingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.studentName, { color: colors.textSecondary }]} numberOfLines={1}>{s.name}</Text>
                      <Text style={[styles.studentMeta, { color: colors.textLight }]}>
                        신청 대기 — {detail.isCoach ? '운영진이 확정하면 로스터에 올라와요' : '레슨 관리에서 확정해 주세요'}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            {/* 날짜 이동 */}
            <View style={[styles.dateBar, { backgroundColor: colors.surface }, shadows.md]}>
              <Pressable onPress={() => shiftDate(-1)} hitSlop={8} style={styles.dateArrow}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.dateText, { color: colors.text }]}>
                  {date.slice(5).replace('-', '/')} ({DAY_KO[dateObj.getDay()]})
                </Text>
                <Text style={[styles.dateHint, { color: isLessonDay ? colors.primary : colors.textLight }]}>
                  {isLessonDay ? '레슨 요일' : '레슨 요일 아님'}
                  {attendTargets.length > 0 ? ` · 출석 ${presentCount}/${attendTargets.length}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => shiftDate(1)} hitSlop={8} style={styles.dateArrow}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>

            {attendLoading ? (
              <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : attendTargets.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="checkbox-outline" size={32} color={colors.textLight} />
                <Text style={[styles.emptyText, { color: colors.textLight }]}>출석 체크할 수강생이 없어요</Text>
              </View>
            ) : (
              attendTargets.map((s) => {
                const on = !!attend[s.id];
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => toggleAttend(s.id)}
                    style={[styles.attendRow, { backgroundColor: colors.surface }, shadows.md]}
                  >
                    <View style={[styles.checkbox, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}>
                      {on && <Ionicons name="checkmark" size={15} color="#fff" />}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.studentName, { color: colors.text }]} numberOfLines={1}>{s.name}</Text>
                      <Text style={[styles.studentMeta, { color: colors.textLight }]}>
                        누적 {s.attendCount}회{s.enrollState === 'PAUSED' ? ' · 휴식중' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.attendState, { color: on ? colors.primary : colors.textLight }]}>
                      {on ? '출석' : '미출석'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1 },
  sub: { ...typography.caption, marginTop: 1 },
  coachTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  coachTagText: { fontSize: 11, fontWeight: '800' },
  coachCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 18, padding: spacing.lg, marginBottom: spacing.md },
  coachPhoto: { width: 56, height: 56, borderRadius: 28 },
  coachPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  coachInitial: { fontSize: 22, fontWeight: '900' },
  coachNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coachName: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  certBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  certText: { fontSize: 10, fontWeight: '800' },
  coachIntro: { ...typography.body2, marginTop: 2 },
  coachMeta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: spacing.md },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 13.5, fontWeight: '800' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  studentCard: { borderRadius: 16, marginBottom: spacing.sm, overflow: 'hidden' },
  studentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  studentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  studentName: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  stateTag: { fontSize: 11, fontWeight: '800' },
  feeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  feeBadgeText: { fontSize: 10, fontWeight: '800' },
  studentMeta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  studentBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  enrollChips: { flexDirection: 'row', gap: spacing.xs },
  enrollChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  enrollChipText: { fontSize: 12.5, fontWeight: '800' },
  noteRow: { flexDirection: 'row', gap: spacing.sm },
  noteInput: { flex: 1, fontSize: 13, fontWeight: '600', borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 9 },
  noteSave: { paddingHorizontal: spacing.lg, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  noteSaveText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  pendingLabel: { fontSize: 12, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.sm, marginLeft: 4 },
  billingStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.md },
  billingText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  billingPayout: { fontSize: 12.5, fontWeight: '900' },
  waitCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: spacing.md, marginBottom: spacing.sm },
  waitRank: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  waitRankText: { fontSize: 14, fontWeight: '900' },
  promoteBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 10 },
  promoteBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  pendingCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderWidth: 1, borderRadius: 16 },
  dateBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginBottom: spacing.md },
  dateArrow: { padding: spacing.sm },
  dateText: { fontSize: 16, fontWeight: '800' },
  dateHint: { fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  attendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 14, padding: spacing.lg, marginBottom: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  attendState: { fontSize: 12.5, fontWeight: '800' },
});

import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Icon } from '../../components/ui/Icon';
import { showSuccess } from '../../utils/feedback';
import {
  type MoneyApi,
  type LabSettlementResponse,
  type LabSessionRow,
  type LabGuestRow,
  type LabGuestApplicationRow,
  type LabDuesConfig,
} from '../../services/lab';

export interface MoneyClub { id: string; name: string; inviteCode: string }

// ─────────────────────────────────────────────────────────────
// 회비 관리(실험실) — 정산·게스트·설정을 한 화면(탭)으로 통합.
// 공용: 모임 선택 + 월 이동. 탭: [정산] [게스트] [설정].
// ─────────────────────────────────────────────────────────────

const won = (n: number) => `${n.toLocaleString()}원`;

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const num = (s: string): number | null => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n <= 0 ? null : n;
};

const TABS = [
  { key: 'settle', label: '정산' },
  { key: 'guests', label: '게스트' },
  { key: 'config', label: '설정' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PERIOD_TYPES: { key: string; label: string }[] = [
  { key: 'NONE', label: '없음' },
  { key: 'MONTHLY', label: '매달' },
  { key: 'QUARTERLY', label: '분기' },
  { key: 'HALF', label: '반기' },
  { key: 'YEARLY', label: '연' },
];

/**
 * 회비 관리 본체 — 실험실(전체 클럽)과 모임 관리(고정 클럽) 양쪽에서 재사용.
 * clubs.length > 1 이면 클럽 선택 칩을 렌더, 1개면 그 클럽 고정.
 */
export function MoneyManager({ clubs, api }: { clubs: MoneyClub[]; api: MoneyApi }) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  // 공용 상태
  const [clubId, setClubId] = useState<string | null>(clubs[0]?.id ?? null);
  const [period, setPeriod] = useState(currentPeriod());
  const [tab, setTab] = useState<TabKey>('settle');

  // 정산
  const [data, setData] = useState<LabSettlementResponse | null>(null);
  const [sessions, setSessions] = useState<LabSessionRow[]>([]);
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // 게스트
  const [guests, setGuests] = useState<LabGuestRow[] | null>(null);
  const [applications, setApplications] = useState<LabGuestApplicationRow[]>([]);
  // 설정
  const [cfgPeriod, setCfgPeriod] = useState('NONE');
  const [dues, setDues] = useState('');
  const [perSession, setPerSession] = useState('');
  const [guestFee, setGuestFee] = useState('');
  const [account, setAccount] = useState('');
  const [saving, setSaving] = useState(false);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clubId && clubs.length) setClubId(clubs[0].id);
  }, [clubs, clubId]);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      if (tab === 'settle') {
        const [d, ss] = await Promise.all([
          api.getSettlement(clubId, period),
          api.getSessions(clubId, period).catch(() => [] as LabSessionRow[]),
        ]);
        setData(d);
        setSessions(ss);
        setCostDraft(Object.fromEntries(ss.map((s) => [s.id, s.rentalCost ? String(s.rentalCost) : ''])));
      } else if (tab === 'guests') {
        const [g, apps] = await Promise.all([
          api.getGuests(clubId, period),
          api.getApplications(clubId).catch(() => [] as LabGuestApplicationRow[]),
        ]);
        setGuests(g);
        setApplications(apps);
      } else {
        const c = await api.getConfig(clubId);
        setCfgPeriod(c.duesPeriodType || 'NONE');
        setDues(c.duesAmount ? String(c.duesAmount) : '');
        setPerSession(c.perSessionFee ? String(c.perSessionFee) : '');
        setGuestFee(c.guestFee ? String(c.guestFee) : '');
        setAccount(c.duesAccountInfo ?? '');
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [clubId, period, tab]);
  useEffect(() => { load(); }, [load]);

  // ── 액션들 ──
  const togglePaid = async (userId: string, paid: boolean, amount: number) => {
    if (!clubId || busyId) return;
    setBusyId(userId);
    try {
      if (paid) await api.unmarkPaid(clubId, userId, period);
      else await api.markPaid(clubId, userId, period, amount);
      await load();
    } finally {
      setBusyId(null);
    }
  };
  const saveRental = async (sessionId: string) => {
    const raw = (costDraft[sessionId] ?? '').replace(/[^0-9]/g, '');
    try {
      await api.setRentalCost(clubId!, sessionId, raw ? parseInt(raw, 10) : null);
      await load();
    } catch { /* noop */ }
  };
  const toggleApplicationPaid = async (a: LabGuestApplicationRow) => {
    if (busyId) return;
    setBusyId(a.id);
    try {
      await api.updateApplication(clubId!, a.id, { feePaid: !a.feePaid });
      await load();
    } finally {
      setBusyId(null);
    }
  };
  // 신청 링크 공유 — 비회원이 로그인 없이 여는 공개 페이지.
  const shareApplyLink = async () => {
    const club = clubs.find((c) => c.id === clubId);
    if (!club) return;
    const url = `https://badmintoncourt.store/guest-apply?code=${club.inviteCode}`;
    const msg = `[${club.name}] 게스트 신청은 여기서 해주세요 🙌\n${url}`;
    try { await Share.share({ message: msg }); } catch { /* noop */ }
  };
  const toggleGuestPaid = async (r: LabGuestRow) => {
    if (busyId) return;
    setBusyId(r.checkInId);
    try {
      await api.setGuestFeePaid(clubId!, r.checkInId, !r.feePaid);
      await load();
    } finally {
      setBusyId(null);
    }
  };
  const saveConfig = async () => {
    if (!clubId || saving) return;
    setSaving(true);
    try {
      await api.setConfig(clubId, {
        duesPeriodType: cfgPeriod,
        duesAmount: num(dues),
        perSessionFee: num(perSession),
        guestFee: num(guestFee),
        duesAccountInfo: account.trim() || null,
      });
      showSuccess('저장했어요');
    } finally {
      setSaving(false);
    }
  };
  const sendRequests = async () => {
    if (!data) return;
    const unpaid = data.members.filter((m) => m.balance > 0);
    if (unpaid.length === 0) return;
    const lines = unpaid.map((m) => `· ${m.name}: ${won(m.balance)}`).join('\n');
    const acct = (data.duesAccountInfo || account || '').trim();
    const acctLine = acct ? `\n\n입금계좌: ${acct}` : '';
    const msg = `[${data.clubName}] ${data.period} 회비/게스트비 정산 안내\n\n${lines}\n\n총 미납 ${won(data.totals.unpaid)}${acctLine}\n\n송금 부탁드려요 🙏`;
    try { await Share.share({ message: msg }); } catch { /* noop */ }
  };

  // ── 공용 UI 조각 ──
  const Avatar = ({ name, tint }: { name: string; tint: string }) => (
    <View style={[styles.avatar, { backgroundColor: alpha(tint, 0.14) }]}>
      <Text style={[styles.avatarText, { color: tint }]}>{name?.[0] ?? '?'}</Text>
    </View>
  );

  const statCards = data ? [
    { label: '총 청구', value: data.totals.billed, tint: colors.primary },
    { label: '납부', value: data.totals.paid, tint: colors.secondary },
    { label: `미납 ${data.totals.unpaidCount}명`, value: data.totals.unpaid, tint: colors.warning },
  ] : [];

  const guestTotal = (guests ?? []).reduce((s, r) => s + (r.feeAmount ?? 0), 0);
  const guestUnpaid = (guests ?? []).filter((r) => !r.feePaid).reduce((s, r) => s + (r.feeAmount ?? 0), 0);
  const guestStatCards = [
    { label: '게스트', value: `${guests?.length ?? 0}명`, tint: colors.primary },
    { label: '게스트비 합계', value: won(guestTotal), tint: colors.secondary },
    { label: '미납', value: won(guestUnpaid), tint: guestUnpaid > 0 ? colors.warning : colors.secondary },
  ];

  const inputField = (label: string, value: string, setter: (s: string) => void, ph: string, numeric = true) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
        value={value}
        onChangeText={setter}
        placeholder={ph}
        placeholderTextColor={colors.textLight}
        keyboardType={numeric ? 'number-pad' : 'default'}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 헤더는 감싸는 화면(wrapper)이 렌더 — 본체는 콘텐츠만. */}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled">
        {/* 모임 선택 */}
        {clubs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
          {clubs.map((c) => {
            const active = c.id === clubId;
            return (
              <Pressable
                key={c.id}
                onPress={() => setClubId(c.id)}
                style={[styles.clubChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 }]}
              >
                <Text style={[styles.clubChipText, { color: active ? '#fff' : colors.textSecondary }]} numberOfLines={1}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        )}

        {/* 탭 */}
        <View style={[styles.segment, { backgroundColor: colors.surfaceSecondary }]}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.segmentBtn, active && [{ backgroundColor: colors.surface }, shadows.sm]]}
              >
                <Text style={[styles.segmentText, { color: active ? colors.primary : colors.textSecondary }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* 월 이동 (설정 탭은 기간 무관) */}
        {tab !== 'config' && (
          <View style={styles.periodRow}>
            <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, -1))} hitSlop={10} style={[styles.periodBtn, { backgroundColor: colors.surface }, shadows.sm]}>
              <Icon name="chevronLeft" size={20} color={colors.text} />
            </Pressable>
            <Text style={[styles.periodText, { color: colors.text }]}>{period}</Text>
            <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, 1))} hitSlop={10} style={[styles.periodBtn, { backgroundColor: colors.surface }, shadows.sm]}>
              <Icon name="chevronRight" size={20} color={colors.text} />
            </Pressable>
          </View>
        )}

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : tab === 'settle' && data ? (
          <>
            {/* 요약 — 틴트 스탯 카드 */}
            <View style={styles.statRow}>
              {statCards.map((s) => (
                <View key={s.label} style={[styles.statCard, { backgroundColor: alpha(s.tint, 0.1) }]}>
                  <Text style={[styles.statValue, { color: s.tint }]}>{won(s.value)}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {data.monthlyDuesAmount == null && (
              <Text style={[styles.note, { color: colors.textLight }]}>* 정기 회비 미설정 — 설정 탭에서 주기·금액을 정하면 자동 청구돼요.</Text>
            )}

            {/* 정모별 대관비 엔빵 */}
            {sessions.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>정모별 대관비 (엔빵)</Text>
                <Text style={[styles.cardHint, { color: colors.textLight }]}>총액을 입력하면 참석자 수로 1/N 자동 청구</Text>
                {sessions.map((s) => (
                  <View key={s.id} style={styles.sessRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                        {s.title || (s.date ? s.date.slice(0, 10) : '정모')}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.textLight }]}>
                        참석 {s.attendees}명{s.perHead ? ` · 1인 ${won(s.perHead)}` : ''}
                      </Text>
                    </View>
                    <TextInput
                      style={[styles.sessInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={costDraft[s.id] ?? ''}
                      onChangeText={(t) => setCostDraft((d) => ({ ...d, [s.id]: t }))}
                      onBlur={() => saveRental(s.id)}
                      placeholder="대관비"
                      placeholderTextColor={colors.textLight}
                      keyboardType="number-pad"
                    />
                  </View>
                ))}
              </View>
            )}

            {/* 청구 메시지 */}
            <Pressable
              onPress={sendRequests}
              disabled={data.totals.unpaidCount === 0}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: data.totals.unpaidCount > 0 ? colors.primary : colors.surface3 },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.primaryBtnText, { color: data.totals.unpaidCount > 0 ? '#fff' : colors.textLight }]}>
                미납 {data.totals.unpaidCount}명에게 청구 메시지 보내기
              </Text>
            </Pressable>

            {/* 멤버별 */}
            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>멤버별 청구</Text>
              {data.members.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textLight }]}>멤버가 없어요</Text>
              ) : (
                data.members.map((m, i) => (
                  <View key={m.userId} style={[styles.mRow, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <Avatar name={m.name} tint={m.balance > 0 ? colors.warning : colors.secondary} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                        {m.name}{m.isGuest ? ' · 게스트' : ''}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.textLight }]} numberOfLines={1}>
                        {[
                          m.dues > 0 && `회비 ${won(m.dues)}`,
                          m.sessionFees > 0 && `참가비 ${won(m.sessionFees)}`,
                          m.splitFees > 0 && `엔빵 ${won(m.splitFees)}`,
                          m.guestFees > 0 && `게스트비 ${won(m.guestFees)}`,
                        ].filter(Boolean).join(' · ') || '청구 없음'}
                      </Text>
                    </View>
                    {m.total === 0 && !m.duesPaid ? null : m.duesPaid ? (
                      <Pressable onPress={() => togglePaid(m.userId, true, m.total)} disabled={busyId === m.userId} style={[styles.paidBtn, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
                        <Text style={[styles.paidBtnText, { color: colors.secondary }]}>완납 ✓</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => togglePaid(m.userId, false, m.total)} disabled={busyId === m.userId} style={[styles.payBtn, { backgroundColor: colors.primary }, busyId === m.userId && { opacity: 0.5 }]}>
                        <Text style={styles.payBtnAmt}>{won(m.balance)}</Text>
                        <Text style={styles.payBtnText}>입금확인</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>
            <Text style={[styles.note, { color: colors.textLight }]}>* 계산·청구·추적만 해요 — 돈은 기존 계좌(모임통장)로 받고, 입금 보이면 원클릭 확인.</Text>
          </>
        ) : tab === 'guests' ? (
          <>
            <View style={styles.statRow}>
              {guestStatCards.map((s) => (
                <View key={s.label} style={[styles.statCard, { backgroundColor: alpha(s.tint, 0.1) }]}>
                  <Text style={[styles.statValue, { color: s.tint }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
                </View>
              ))}
            </View>
            {/* 사전 신청 — 공개 링크로 들어온 신청서 */}
            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>사전 신청</Text>
                <Pressable onPress={shareApplyLink} style={[styles.linkBtn, { backgroundColor: alpha(colors.primary, 0.1) }]}>
                  <Text style={[styles.linkBtnText, { color: colors.primary }]}>신청 링크 공유</Text>
                </Pressable>
              </View>
              <Text style={[styles.cardHint, { color: colors.textLight }]}>비회원이 링크로 신청 → 입금 안내 → 입금확인하면 확정</Text>
              {applications.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textLight }]}>아직 신청이 없어요 — 링크를 공유해 보세요</Text>
              ) : (
                applications.map((a, i) => (
                  <View key={a.id} style={[styles.mRow, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <Avatar name={a.name} tint={a.status === 'CONFIRMED' ? colors.secondary : colors.info} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                          {a.name}
                          {a.skillLevel ? ` · ${a.skillLevel}조` : ''}
                          {a.gender ? ` · ${a.gender === 'M' ? '남' : '여'}` : ''}
                        </Text>
                        {a.isCheckedIn && (
                          <View style={[styles.appUserTag, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
                            <Text style={[styles.appUserTagText, { color: colors.secondary }]}>출석 ✓</Text>
                          </View>
                        )}
                        {a.status === 'WAITLIST' && (
                          <View style={[styles.appUserTag, { backgroundColor: alpha(colors.warning, 0.12) }]}>
                            <Text style={[styles.appUserTagText, { color: colors.warning }]}>대기</Text>
                          </View>
                        )}
                        {a.isAppUser && (
                          <View style={[styles.appUserTag, { backgroundColor: alpha(colors.info, 0.12) }]}>
                            <Text style={[styles.appUserTagText, { color: colors.info }]}>앱 회원</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.rowMeta, { color: colors.textLight }]} numberOfLines={1}>
                        {a.visitDate ? `${a.visitDate.slice(5).replace('-', '/')} 방문` : a.createdAt.slice(0, 10)}
                        {a.phone ? ` · ${a.phone}` : ''}
                        {a.note ? ` · ${a.note}` : ''}
                      </Text>
                    </View>
                    {a.status === 'CONFIRMED' ? (
                      <Pressable onPress={() => toggleApplicationPaid(a)} style={[styles.paidBtn, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
                        <Text style={[styles.paidBtnText, { color: colors.secondary }]}>확정 ✓</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => toggleApplicationPaid(a)} disabled={busyId === a.id} style={[styles.payBtn, { backgroundColor: colors.info }, busyId === a.id && { opacity: 0.5 }]}>
                        {a.feeAmount != null && <Text style={styles.payBtnAmt}>{won(a.feeAmount)}</Text>}
                        <Text style={styles.payBtnText}>입금확인·확정</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>게스트 목록</Text>
              {(guests ?? []).length === 0 ? (
                <Text style={[styles.empty, { color: colors.textLight }]}>이 기간 게스트가 없어요</Text>
              ) : (
                (guests ?? []).map((r, i) => (
                  <View key={r.checkInId} style={[styles.mRow, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <Avatar name={r.name} tint={r.feePaid ? colors.secondary : colors.warning} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{r.name}</Text>
                      <Text style={[styles.rowMeta, { color: colors.textLight }]} numberOfLines={1}>
                        {r.date.slice(0, 10)}{r.sessionTitle ? ` · ${r.sessionTitle}` : ''}
                      </Text>
                    </View>
                    {r.feeAmount == null ? (
                      <Text style={[styles.rowMeta, { color: colors.textLight }]}>게스트비 없음</Text>
                    ) : r.feePaid ? (
                      <Pressable onPress={() => toggleGuestPaid(r)} style={[styles.paidBtn, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
                        <Text style={[styles.paidBtnText, { color: colors.secondary }]}>납부 ✓</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => toggleGuestPaid(r)} style={[styles.payBtn, { backgroundColor: colors.warning }, busyId === r.checkInId && { opacity: 0.5 }]}>
                        <Text style={styles.payBtnAmt}>{won(r.feeAmount)}</Text>
                        <Text style={styles.payBtnText}>입금확인</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>
            <Text style={[styles.note, { color: colors.textLight }]}>* 게스트 유입은 기존 그대로(QR 셀프 체크인 · 운영판 게스트 추가). 설정 탭의 게스트비가 자동 청구돼요.</Text>
          </>
        ) : tab === 'config' ? (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>정기 회비</Text>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>주기</Text>
              <View style={styles.periodTypeRow}>
                {PERIOD_TYPES.map((p) => {
                  const active = p.key === cfgPeriod;
                  return (
                    <Pressable key={p.key} onPress={() => setCfgPeriod(p.key)} style={[styles.ptChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border }]}>
                      <Text style={[styles.ptChipText, { color: active ? '#fff' : colors.textSecondary }]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {cfgPeriod !== 'NONE' && inputField(`회비 금액 (${PERIOD_TYPES.find((p) => p.key === cfgPeriod)?.label}당, 원)`, dues, setDues, '예: 30000')}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>참가비·게스트비</Text>
              {inputField('정모별 참가비 (번개비, 원 · 선택)', perSession, setPerSession, '예: 5000')}
              {inputField('게스트비 기본 (원 · 선택)', guestFee, setGuestFee, '예: 7000')}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>입금 안내 계좌</Text>
              {inputField('청구 메시지에 자동 포함돼요', account, setAccount, '예: 카카오뱅크 3333-01-1234567 홍길동', false)}
            </View>

            <Pressable onPress={saveConfig} disabled={saving} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary }, (saving || pressed) && { opacity: 0.8 }]}>
              <Text style={[styles.primaryBtnText, { color: '#fff' }]}>{saving ? '저장 중…' : '설정 저장'}</Text>
            </Pressable>
            <Text style={[styles.note, { color: colors.textLight }]}>* 정기 회비(주기당) + 정모 참가비 + 대관비 엔빵 + 게스트비가 정산 탭에 자동 합산돼요.</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },

  clubChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, maxWidth: 200, justifyContent: 'center' },
  clubChipText: { ...typography.body2, fontWeight: '800' },

  segment: { flexDirection: 'row', borderRadius: radius.lg, padding: 3, marginBottom: spacing.md },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md },
  segmentText: { ...typography.subtitle2 },

  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.md },
  periodBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  periodText: { ...typography.h3, minWidth: 100, textAlign: 'center' },

  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.lg, borderRadius: radius.lg, paddingHorizontal: 4 },
  statValue: { ...typography.subtitle1, fontWeight: '900' },
  statLabel: { ...typography.caption, marginTop: 3, fontWeight: '600' },

  card: { borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { ...typography.subtitle1, marginBottom: 2 },
  cardHint: { ...typography.caption, marginBottom: spacing.sm },

  sessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  sessInput: { ...typography.body2, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, width: 110, textAlign: 'right', fontWeight: '700' },

  mRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.smd },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  rowName: { ...typography.body1, fontWeight: '700' },
  rowMeta: { ...typography.caption, marginTop: 1 },

  payBtn: { alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, minWidth: 88 },
  payBtnAmt: { color: '#fff', fontSize: 13, fontWeight: '900' },
  payBtnText: { color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: '800', marginTop: 1 },
  paidBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, minWidth: 88, alignItems: 'center' },
  paidBtnText: { fontSize: 13, fontWeight: '900' },

  primaryBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', marginBottom: spacing.md },
  primaryBtnText: { ...typography.button },

  periodTypeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  ptChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  ptChipText: { ...typography.body2, fontWeight: '800' },

  field: { marginTop: spacing.sm },
  fieldLabel: { ...typography.caption, fontWeight: '700', marginBottom: spacing.xs },
  fieldInput: { ...typography.body1, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontWeight: '700' },

  empty: { ...typography.body2, paddingVertical: spacing.lg, textAlign: 'center' },
  note: { ...typography.caption, lineHeight: 17, marginBottom: spacing.md },
  linkBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  linkBtnText: { fontSize: 12, fontWeight: '800' },
  appUserTag: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm },
  appUserTagText: { fontSize: 10, fontWeight: '800' },
});

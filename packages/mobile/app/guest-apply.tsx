import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { profileApi } from '../services/profile';
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

interface AvailableDate {
  date: string;
  label: string;
  status: 'OPEN' | 'FULL' | 'CLOSED';
  remaining: number | null;
  capacity?: number | null;
  applied?: number;
  waiting?: number;
}
interface ClubInfo {
  clubId: string;
  clubName: string;
  description?: string | null;
  memberCount?: number;
  region?: string | null;
  guestFee: number | null;
  accountInfo: string | null;
  contactInfo?: string | null;
  scheduleSummary?: string | null;
  applyClosed?: boolean;
  availableDates?: AvailableDate[];
}
interface ApplyResult { id: string; clubName: string; feeAmount: number | null; accountInfo: string | null; contactInfo?: string | null; message: string }

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
  const { code, clubId } = useLocalSearchParams<{ code?: string; clubId?: string }>();
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated } = useAuthStore();
  // 진입 경로: 초대코드(공유 링크) 또는 clubId(모임 찾기 — PUBLIC 전용).
  const basePath = clubId ? `/guest-apply/by-id/${encodeURIComponent(String(clubId))}` : code ? `/guest-apply/${encodeURIComponent(String(code))}` : null;

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
    if (!basePath) { setLoading(false); return; }
    api.get(basePath, { _silent: true } as any)
      .then(({ data }) => setClub(data))
      .catch(() => setClub(null))
      .finally(() => setLoading(false));
  }, [basePath]);

  // 로그인 유저면 이름·급수·성별 자동 채움(수정 가능). 신청 요청엔 토큰이 자동
  // 첨부돼 서버가 userId를 연결한다('앱 회원' 표시).
  useEffect(() => {
    if (!isAuthenticated) return;
    if (user?.name) setName((prev) => prev || user.name);
    profileApi.getProfile()
      .then(({ data }) => {
        if (data?.skillLevel) setSkill((prev) => prev ?? data.skillLevel);
        if (data?.gender === 'M' || data?.gender === 'F') setGender((prev) => prev ?? data.gender);
      })
      .catch(() => {});
  }, [isAuthenticated, user?.name]);

  const submit = async () => {
    if (!club || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post(basePath!, {
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

  // 문의 채널: URL이면 새 탭/브라우저로, 아니면(전화번호 등) 그대로 보여주기만.
  const contactIsLink = (v?: string | null) => !!v && /^https?:\/\//i.test(v.trim());
  const openContact = (v?: string | null) => {
    if (!v) return;
    if (contactIsLink(v) && Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.open(v.trim(), '_blank'); } catch { /* noop */ }
    }
  };

  const openInAppChat = () => {
    const q = clubId ? `clubId=${encodeURIComponent(String(clubId))}` : `code=${encodeURIComponent(String(code))}`;
    const nm = name.trim() ? `&name=${encodeURIComponent(name.trim())}` : '';
    router.push(`/guest-chat?${q}${nm}` as any);
  };

  const openStore = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.open(APP_STORE_URL, '_blank'); } catch { /* noop */ }
    }
  };

  // 핵심 항목: 이름·급수·성별·희망일. 연락처는 선택(입력 시에만 형식 검사는 서버에서).
  const canSubmit = name.trim().length >= 1 && !!skill && !!gender && !!visitDate;
  // 서버가 계산한 신청 가능 날짜(정책 반영). 없으면(구버전 응답) 기존 7일 폴백.
  const availableDates: AvailableDate[] =
    club?.availableDates && club.availableDates.length > 0
      ? club.availableDates
      : dates.map((d) => ({ date: d.value, label: d.label, status: 'OPEN' as const, remaining: null }));

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
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <Text style={[styles.title, { color: colors.text }]}>모임을 찾을 수 없어요</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>초대 링크를 다시 확인해 주세요.</Text>
        </View>
      ) : result ? (
        // ── 신청 완료: 입금 안내 ──
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <View style={[styles.okBadge, { backgroundColor: alpha(colors.secondary, 0.12) }]}>
            <Text style={[styles.okBadgeText, { color: colors.secondary }]}>신청 접수 ✓</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{result.clubName} 게스트 신청 완료</Text>
          {!!visitDate && (
            <View style={styles.resultVisitRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.resultVisitText, { color: colors.text }]}>
                방문일 {availableDates.find((d) => d.date === visitDate)?.label ?? visitDate}
              </Text>
            </View>
          )}
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

          <Pressable
            onPress={openInAppChat}
            style={({ pressed }) => [styles.contactBtn, { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.06) }, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.contactBtnTitle, { color: colors.text }]}>운영진에게 문의하기</Text>
              <Text style={[styles.contactBtnValue, { color: colors.textSecondary }]}>확정·입금·주차 등 무엇이든 물어보세요</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
          </Pressable>

          {isAuthenticated ? (
            <Pressable onPress={() => router.replace('/(tabs)')} style={({ pressed }) => [styles.storeBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}>
              <Text style={styles.storeBtnText}>홈으로 돌아가기</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openStore} style={({ pressed }) => [styles.storeBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}>
              <Text style={styles.storeBtnText}>콕고 앱 설치하고 게임 현황 보기</Text>
            </Pressable>
          )}
        </View>
      ) : club.applyClosed ? (
        // ── 신청 받지 않음 ──
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <Text style={[styles.title, { color: colors.text }]}>{club.clubName}</Text>
          {club.scheduleSummary && (
            <Text style={[styles.previewMeta, { color: colors.textSecondary }]}>{club.scheduleSummary}</Text>
          )}
          <Text style={[styles.desc, { color: colors.textSecondary }]}>
            지금은 게스트 신청을 받지 않아요. 나중에 다시 확인해 주세요.
          </Text>
        </View>
      ) : (
        // ── 신청 폼 ──
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          {/* 히어로 — 모임 정체성이 한눈에 */}
          <View style={styles.hero}>
            <View style={[styles.heroAvatar, { backgroundColor: alpha(colors.primary, 0.14) }]}>
              <Text style={[styles.heroAvatarText, { color: colors.primary }]}>{club.clubName.slice(0, 1)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: colors.text, marginBottom: 2 }]}>{club.clubName}</Text>
              <View style={styles.heroMetaRow}>
                {!!club.region && (
                  <View style={styles.heroMetaItem}>
                    <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                    <Text style={[styles.heroMetaText, { color: colors.textSecondary }]}>{club.region}</Text>
                  </View>
                )}
                {club.memberCount != null && (
                  <View style={styles.heroMetaItem}>
                    <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
                    <Text style={[styles.heroMetaText, { color: colors.textSecondary }]}>멤버 {club.memberCount}명</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          {!!club.scheduleSummary && (
            <View style={[styles.scheduleBanner, { backgroundColor: alpha(colors.primary, 0.08) }]}>
              <Ionicons name="calendar-outline" size={14} color={colors.primary} />
              <Text style={[styles.scheduleBannerText, { color: colors.primary }]}>매주 {club.scheduleSummary.replace(/^매주 /, '')}</Text>
            </View>
          )}
          {club.description && (
            <Text style={[styles.previewDesc, { color: colors.textLight }]} numberOfLines={3}>{club.description}</Text>
          )}
          {club.guestFee != null && (
            <View style={[styles.feeBanner, { backgroundColor: colors.background }]}>
              <Text style={[styles.feeBannerLabel, { color: colors.textSecondary }]}>게스트비</Text>
              <Text style={[styles.feeBannerAmount, { color: colors.text }]}>{club.guestFee.toLocaleString()}원</Text>
              <Text style={[styles.feeBannerHint, { color: colors.textLight }]}>신청 후 입금 안내를 드려요</Text>
            </View>
          )}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>이름 <Text style={{ color: colors.danger }}>*</Text></Text>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.background }]}
            value={name}
            onChangeText={setName}
            placeholder="홍길동"
            placeholderTextColor={colors.textLight}
            maxLength={20}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>급수 <Text style={{ color: colors.danger }}>*</Text></Text>
          <View style={styles.chipRow}>
            {SKILL_LEVELS.map((lv) => {
              const meta = SKILL_META[lv];
              const active = skill === lv;
              return (
                <Pressable
                  key={lv}
                  onPress={() => setSkill(lv)}
                  style={[styles.skillChip, active ? { backgroundColor: meta.color } : { backgroundColor: colors.background }]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{lv}</Text>
                </Pressable>
              );
            })}
          </View>
          {skill && <Text style={[styles.chipHint, { color: SKILL_META[skill].color }]}>{skill} · {SKILL_META[skill].description}</Text>}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>성별 <Text style={{ color: colors.danger }}>*</Text></Text>
          <View style={styles.chipRow}>
            {([{ k: 'M', label: '남' }, { k: 'F', label: '여' }] as const).map((g) => {
              const active = gender === g.k;
              return (
                <Pressable
                  key={g.k}
                  onPress={() => setGender(g.k)}
                  style={[styles.genderChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background }]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>참석 희망일 <Text style={{ color: colors.danger }}>*</Text>{club.scheduleSummary ? '  (운동 요일만)' : ''}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {availableDates.map((d) => {
              const active = visitDate === d.date;
              // 정원 마감(FULL)은 '대기 신청'으로 선택 가능 — 날짜 마감(CLOSED)만 비활성.
              const disabled = d.status === 'CLOSED';
              return (
                <Pressable
                  key={d.date}
                  disabled={disabled}
                  onPress={() => setVisitDate(d.date)}
                  style={[
                    styles.dateChip,
                    active
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.background },
                    disabled && { opacity: 0.4 },
                  ]}
                >
                  <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>{active ? '✓ ' : ''}{d.label}</Text>
                  {d.status === 'FULL' ? (
                    <Text style={[styles.dateSub, { color: active ? 'rgba(255,255,255,0.9)' : colors.warning }]}>
                      {d.capacity != null ? `${d.applied ?? 0}/${d.capacity} 마감` : '마감'}{(d.waiting ?? 0) > 0 ? ` · 대기 ${d.waiting}` : ''} · 대기 신청
                    </Text>
                  ) : d.status === 'CLOSED' ? (
                    <Text style={[styles.dateSub, { color: colors.textLight }]}>신청 마감</Text>
                  ) : d.capacity != null ? (
                    <Text style={[styles.dateSub, { color: active ? 'rgba(255,255,255,0.9)' : colors.secondary }]}>
                      {`모집 ${d.capacity} · 신청 ${d.applied ?? 0}`}
                    </Text>
                  ) : (d.applied ?? 0) > 0 ? (
                    <Text style={[styles.dateSub, { color: active ? 'rgba(255,255,255,0.9)' : colors.secondary }]}>{`신청 ${d.applied}명`}</Text>
                  ) : null}
                </Pressable>
              );
            })}
            {availableDates.length === 0 && (
              <Text style={[styles.dateSub, { color: colors.textLight }]}>신청 가능한 날짜가 없어요</Text>
            )}
          </ScrollView>
          {(() => {
            const sel = availableDates.find((d) => d.date === visitDate);
            if (!sel) return null;
            const parts = [
              sel.capacity != null ? `하루 모집 ${sel.capacity}명` : null,
              `현재 신청 ${sel.applied ?? 0}명`,
              (sel.waiting ?? 0) > 0 ? `대기 ${sel.waiting}명` : null,
              sel.status === 'FULL' ? '정원이 차서 대기로 접수돼요' : sel.remaining != null ? `${sel.remaining}자리 남음` : null,
            ].filter(Boolean);
            return (
              <View style={[styles.selectedDateInfo, { backgroundColor: alpha(sel.status === 'FULL' ? colors.warning : colors.secondary, 0.1) }]}>
                <Ionicons name={sel.status === 'FULL' ? 'time-outline' : 'checkmark-circle-outline'} size={14} color={sel.status === 'FULL' ? colors.warning : colors.secondary} />
                <Text style={[styles.selectedDateInfoText, { color: sel.status === 'FULL' ? colors.warning : colors.secondary }]}>{parts.join(' · ')}</Text>
              </View>
            );
          })()}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>연락처 (선택)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.background }]}
            value={phone}
            onChangeText={setPhone}
            placeholder="01012345678"
            placeholderTextColor={colors.textLight}
            keyboardType="phone-pad"
            maxLength={13}
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>한마디 (선택)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.background }]}
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
              canSubmit && shadows.colored(colors.primary),
              (pressed || submitting) && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.submitBtnText, { color: canSubmit ? '#fff' : colors.textLight }]}>
              {submitting ? '신청 중…' : '게스트 신청하기'}
            </Text>
          </Pressable>

          {/* 인앱 문의 채팅 — 비회원도 로그인 없이 운영진과 대화 */}
          <Pressable
            onPress={openInAppChat}
            style={({ pressed }) => [styles.contactBtn, { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.06) }, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.contactBtnTitle, { color: colors.text }]}>궁금한 게 있나요? 운영진에게 문의하기</Text>
              <Text style={[styles.contactBtnValue, { color: colors.textSecondary }]}>앱 안에서 바로 대화해요 · 답장은 알림/이 페이지에서 확인</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
          </Pressable>

          {/* 운영자가 외부 채널(오픈채팅 등)을 등록했으면 함께 안내 */}
          {!!club.contactInfo && contactIsLink(club.contactInfo) && (
            <Pressable
              onPress={() => openContact(club.contactInfo)}
              style={({ pressed }) => [styles.contactAltBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="open-outline" size={13} color={colors.textLight} />
              <Text style={[styles.contactAltText, { color: colors.textSecondary }]}>외부 채널(오픈채팅 등)로 문의</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brand: { ...typography.h2, textAlign: 'center', marginBottom: spacing.lg },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  card: { borderRadius: 24, padding: spacing.xl },
  title: { ...typography.h3, marginBottom: spacing.sm },
  previewMeta: { ...typography.caption, fontWeight: '700', marginTop: -4, marginBottom: spacing.xs },
  previewDesc: { ...typography.caption, lineHeight: 17, marginBottom: spacing.sm },
  desc: { ...typography.body2, lineHeight: 20, marginBottom: spacing.md },
  fieldLabel: { ...typography.caption, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { ...typography.body1, fontWeight: '600', borderRadius: 14, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  error: { ...typography.caption, fontWeight: '700', marginTop: spacing.sm },
  submitBtn: { paddingVertical: 17, borderRadius: 16, alignItems: 'center', marginTop: spacing.xl },
  submitBtnText: { ...typography.button, fontSize: 16, fontWeight: '900' },
  okBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginBottom: spacing.md },
  okBadgeText: { fontSize: 12, fontWeight: '900' },
  payBox: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  payLabel: { ...typography.caption, fontWeight: '700' },
  payAmount: { ...typography.h2, marginTop: 2 },
  payAccount: { ...typography.subtitle1, marginTop: 2 },
  storeBtn: { paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginTop: spacing.sm },
  storeBtnText: { ...typography.button, color: '#fff' },

  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', paddingVertical: 2 },
  skillChip: { width: 46, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  skillChipText: { ...typography.body2, fontWeight: '900' },
  genderChip: { width: 68, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dateChip: { paddingHorizontal: spacing.lg, minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dateSub: { fontSize: 9, fontWeight: '800', marginTop: 1 },
  chipHint: { ...typography.caption, fontWeight: '800', marginTop: spacing.xs },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  heroAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  heroAvatarText: { fontSize: 22, fontWeight: '900' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroMetaText: { ...typography.caption, fontWeight: '700' },
  scheduleBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  scheduleBannerText: { ...typography.caption, fontWeight: '800' },
  feeBanner: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  feeBannerLabel: { ...typography.caption, fontWeight: '700' },
  feeBannerAmount: { ...typography.subtitle1, fontWeight: '900' },
  feeBannerHint: { fontSize: 10, fontWeight: '600' },
  resultVisitRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  resultVisitText: { ...typography.body2, fontWeight: '800' },
  selectedDateInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm },
  selectedDateInfoText: { ...typography.caption, fontWeight: '800', flex: 1 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginTop: spacing.md },
  contactBtnTitle: { ...typography.caption, fontWeight: '800' },
  contactBtnValue: { fontSize: 11, fontWeight: '700', marginTop: 1 },
  contactAltBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.sm, marginTop: spacing.xs },
  contactAltText: { fontSize: 11, fontWeight: '700' },
});

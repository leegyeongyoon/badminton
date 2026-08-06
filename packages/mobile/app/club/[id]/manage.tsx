import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { useClubStore } from '../../../store/clubStore';
import { useAuthStore } from '../../../store/authStore';
import { Icon } from '../../../components/ui/Icon';
import { BackButton } from '../../../components/ui/BackButton';
import { Button } from '../../../components/ui/Button';
import {
  clubApi,
  ClubMemberResponse,
  MemberAttendance,
  DuesSettlement,
  formatKRW,
} from '../../../services/club';
import { AttendanceLeaderboard } from '../../../components/club/AttendanceLeaderboard';
import { facilityApi } from '../../../services/facility';
import { AddFacilityModal } from '../../../components/AddFacilityModal';
import { showAlert, showConfirm } from '../../../utils/alert';
import { showSuccess } from '../../../utils/feedback';
import { Strings } from '../../../constants/strings';
import { typography, spacing, radius } from '../../../constants/theme';
import { GENDER_META, type Gender } from '../../../constants/gender';
import { GenderMarker } from '../../../components/ui/GenderMarker';
import { ScreenContainer } from '../../../components/ui/ScreenContainer';
import { staffGuestChatApi } from '../../../services/guestChat';
import { useResponsiveLayout } from '../../../hooks/useResponsiveLayout';

// 역할/급수 라벨 + 선택지 (멤버·운영진 섹션 전용).
const ROLE_LABELS: Record<string, string> = { LEADER: '대표', STAFF: '운영진', MEMBER: '회원' };
const ROLE_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'STAFF', label: '운영진', desc: '정모 운영·순번 관리 권한' },
  { value: 'MEMBER', label: '회원', desc: '일반 회원' },
];
const SKILL_OPTIONS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

// ─────────────────────────────────────────────────────────
// 모임 관리 허브 (운영진 전용) — 한 모임의 운영 도구를 모은 화면.
//  • 클럽 정보   이름 / 홈 시설 / 소개 / 초대코드·QR (이번 Part 완성)
//  • 멤버·운영진 / 출석 / 회비 — 자리만 잡아둔 섹션 (다음 Part 채움)
//  • 모임 삭제   2단계 확인 후 삭제 → 설정으로 복귀
// 권한: 해당 모임의 LEADER/STAFF 만. 일반 멤버는 "권한이 없어요" + 뒤로.
// WEB-SAFE: refreshControl 미사용, multiline TextInput 만 사용.
// ─────────────────────────────────────────────────────────

interface Facility {
  id: string;
  name: string;
}

export default function ClubManageScreen() {
  const router = useRouter();
  const { id: clubId } = useLocalSearchParams<{ id: string }>();

  // 게스트 문의 미읽음(뱃지) — 화면 진입 시 1회 조회.
  const [guestUnread, setGuestUnread] = useState(0);
  useEffect(() => {
    if (!clubId) return;
    staffGuestChatApi.unreadCount(String(clubId)).then(setGuestUnread).catch(() => {});
  }, [clubId]);
  const { colors, shadows } = useTheme();
  const { clubs, fetchClubs, deleteClub } = useClubStore();
  const myUserId = useAuthStore((s) => s.user?.id);
  // 태블릿/데스크톱(>=768)에서는 바텀시트 모달을 가운데 다이얼로그로 전환.
  const { isTablet } = useResponsiveLayout();

  const club = useMemo(() => clubs.find((c) => c.id === clubId), [clubs, clubId]);
  // 운영진(LEADER/STAFF)만 접근. clubs 의 role 로 판정 (목록에 내 역할이 담겨 있음).
  const isStaff = club?.role === 'LEADER' || club?.role === 'STAFF' || !!club?.isLeader;
  // 역할 변경·내보내기는 LEADER 만 (STAFF 는 급수 편집만).
  const isLeader = club?.role === 'LEADER' || !!club?.isLeader;

  // 클럽 정보 폼 상태
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homeFacilityId, setHomeFacilityId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  // 모임 공개 여부 — PUBLIC이면 '모임 찾기'에 노출(게스트 신청 가능). 토글 즉시 저장.
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE');
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [clubType, setClubType] = useState<'CLUB' | 'MEETUP'>('CLUB');
  const [clubTypeSaving, setClubTypeSaving] = useState(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [showAddFacility, setShowAddFacility] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 멤버·운영진 섹션 상태.
  const [members, setMembers] = useState<ClubMemberResponse[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberSearch, setMemberSearch] = useState('');
  // 선택된 멤버의 액션 시트(역할/급수/내보내기). null 이면 닫힘.
  const [actionMember, setActionMember] = useState<ClubMemberResponse | null>(null);
  // 'role' | 'skill' | 'gender' | null — 액션 시트 안에서 어떤 편집 패널을 보여줄지.
  const [editMode, setEditMode] = useState<'role' | 'skill' | 'gender' | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

  // ── 출석 이력 모달 상태 (멤버별 정모 이력) ──
  // 어떤 멤버의 이력을 보는지 (null = 닫힘) + 로드된 이력.
  const [historyMember, setHistoryMember] = useState<{ userId: string; name: string } | null>(null);
  const [history, setHistory] = useState<MemberAttendance | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 회비 섹션 상태 ──
  // 현재 보고 있는 월 (YYYY-MM). 초기값은 이번 달 (로컬 기준).
  const [duesPeriod, setDuesPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dues, setDues] = useState<DuesSettlement | null>(null);
  const [duesLoading, setDuesLoading] = useState(false);
  // 회비 금액 미설정 시 인라인 입력값.
  const [duesAmountInput, setDuesAmountInput] = useState('');
  const [duesAmountSaving, setDuesAmountSaving] = useState(false);
  // 토글 진행 중인 회원 id (optimistic 중복 탭 방지).
  const [duesBusyUserId, setDuesBusyUserId] = useState<string | null>(null);

  // 멤버 목록 로드 (운영진만 접근하므로 진입 시 한 번).
  const loadMembers = useCallback(async () => {
    if (!clubId) return;
    setMembersLoading(true);
    try {
      const { data } = await clubApi.getMembers(clubId);
      setMembers(Array.isArray(data) ? data : []);
    } catch {
      /* silent — 빈 목록으로 둠 */
    } finally {
      setMembersLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // 모임 목록을 아직 안 받았을 수도 있어 진입 시 한 번 보장.
  useEffect(() => {
    if (clubs.length === 0) fetchClubs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 폼 prefill — club 이 로드되면 현재 값으로 채움.
  useEffect(() => {
    if (!club) return;
    setName(club.name ?? '');
    setDescription(club.description ?? '');
    setHomeFacilityId(club.homeFacilityId ?? null);
    setInviteCode(club.inviteCode ?? '');
    setVisibility(((club as any).visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'));
    setClubType(((club as any).clubType === 'MEETUP' ? 'MEETUP' : 'CLUB'));
  }, [club?.id, club?.name, club?.description, club?.homeFacilityId, club?.inviteCode]);

  // 시설 목록 (홈 시설 선택용).
  const loadFacilities = useCallback(async () => {
    try {
      const { data } = await facilityApi.list();
      setFacilities(Array.isArray(data) ? data : []);
    } catch {
      /* silent — 시설 목록 없어도 나머지는 동작 */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadFacilities().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [loadFacilities]);

  // 장소 추가 성공 → 목록 새로고침 + 새 장소를 홈 시설로 선택.
  const handleFacilityCreated = useCallback(
    async (facilityId: string) => {
      await loadFacilities();
      setHomeFacilityId(facilityId);
    },
    [loadFacilities],
  );

  const handleSave = useCallback(async () => {
    if (!clubId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert('알림', '모임 이름을 입력해 주세요');
      return;
    }
    setSaving(true);
    try {
      await clubApi.updateClub(clubId, {
        name: trimmed,
        homeFacilityId: homeFacilityId,
        description: description.trim() ? description.trim() : null,
      });
      await fetchClubs();
      showSuccess('모임 정보를 저장했어요');
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  }, [clubId, name, homeFacilityId, description, fetchClubs]);

  const handleRegenerate = useCallback(() => {
    if (!clubId) return;
    showConfirm(
      '초대코드 재발급',
      '새 코드를 발급하면 기존 초대코드·QR·링크는 더 이상 사용할 수 없어요. 계속할까요?',
      async () => {
        setRegenerating(true);
        try {
          const { data } = await clubApi.regenerateInvite(clubId);
          setInviteCode(data.inviteCode);
          await fetchClubs();
          showSuccess('새 초대코드를 발급했어요');
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.error || '재발급에 실패했습니다');
        } finally {
          setRegenerating(false);
        }
      },
      '재발급',
      '취소',
    );
  }, [clubId, fetchClubs]);

  // 모임 삭제 (2단계 확인 — 되돌릴 수 없음) → 설정으로 복귀.
  const handleDelete = useCallback(() => {
    if (!clubId || !club) return;
    showConfirm(
      '모임 삭제',
      `'${club.name}'을(를) 삭제할까요? 모든 정모·출석·게임 기록이 영구 삭제됩니다.`,
      () => {
        showConfirm(
          '정말 삭제할까요?',
          '이 작업은 되돌릴 수 없습니다.',
          async () => {
            try {
              await deleteClub(clubId);
              showSuccess('모임을 삭제했어요');
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/more');
            } catch (err: any) {
              showAlert(Strings.common.error, err?.response?.data?.error || '모임 삭제에 실패했습니다');
            }
          },
          '삭제',
          '취소',
          'danger',
        );
      },
      '삭제',
      '취소',
      'danger',
    );
  }, [clubId, club, deleteClub, router]);

  // 액션 시트 닫기.
  const closeMemberSheet = useCallback(() => {
    setActionMember(null);
    setEditMode(null);
    setMemberBusy(false);
  }, []);

  // 역할 변경 (LEADER 전용) — 운영진 지정/해제. LEADER 로의 승격은 별도 위임 흐름이므로
  // 여기선 STAFF↔MEMBER 만 다룬다 (현재 LEADER 자신은 멤버 목록에서 편집 불가).
  const handleChangeRole = useCallback(
    async (newRole: string) => {
      if (!clubId || !actionMember || actionMember.role === newRole) return;
      setMemberBusy(true);
      try {
        await clubApi.updateMemberRole(clubId, actionMember.userId, newRole);
        showSuccess(newRole === 'STAFF' ? '운영진으로 지정했어요' : '회원으로 변경했어요');
        closeMemberSheet();
        await loadMembers();
      } catch (err: any) {
        setMemberBusy(false);
        showAlert(Strings.common.error, err?.response?.data?.error || '역할 변경에 실패했습니다');
      }
    },
    [clubId, actionMember, loadMembers, closeMemberSheet],
  );

  // 급수 편집 (LEADER/STAFF) — 모임별 급수 override.
  const handleChangeSkill = useCallback(
    async (skill: string) => {
      if (!clubId || !actionMember || actionMember.skillLevel === skill) return;
      setMemberBusy(true);
      try {
        await clubApi.updateMemberProfile(clubId, actionMember.userId, { skillLevel: skill });
        showSuccess(`급수를 ${skill}로 변경했어요`);
        closeMemberSheet();
        await loadMembers();
      } catch (err: any) {
        setMemberBusy(false);
        showAlert(Strings.common.error, err?.response?.data?.error || '급수 변경에 실패했습니다');
      }
    },
    [clubId, actionMember, loadMembers, closeMemberSheet],
  );

  // 성별 편집 (LEADER/STAFF) — 멤버 PlayerProfile 의 성별 수정.
  const handleChangeGender = useCallback(
    async (gender: Gender) => {
      if (!clubId || !actionMember || actionMember.gender === gender) return;
      setMemberBusy(true);
      try {
        await clubApi.updateMemberProfile(clubId, actionMember.userId, { gender });
        showSuccess(`성별을 ${GENDER_META[gender].label}로 변경했어요`);
        closeMemberSheet();
        await loadMembers();
      } catch (err: any) {
        setMemberBusy(false);
        showAlert(Strings.common.error, err?.response?.data?.error || '성별 변경에 실패했습니다');
      }
    },
    [clubId, actionMember, loadMembers, closeMemberSheet],
  );

  // 내보내기 (LEADER 전용) — 확인 후 멤버십 삭제.
  const handleRemoveMember = useCallback(() => {
    if (!clubId || !actionMember) return;
    const target = actionMember;
    showConfirm(
      '멤버 내보내기',
      `'${target.name}'님을 모임에서 내보낼까요? 진행 중인 정모에 참여 중이면 자동으로 체크아웃돼요.`,
      async () => {
        setMemberBusy(true);
        try {
          await clubApi.removeMember(clubId, target.userId);
          showSuccess(`${target.name}님을 내보냈어요`);
          closeMemberSheet();
          await loadMembers();
        } catch (err: any) {
          setMemberBusy(false);
          showAlert(Strings.common.error, err?.response?.data?.error || '내보내기에 실패했습니다');
        }
      },
      '내보내기',
      '취소',
      'danger',
    );
  }, [clubId, actionMember, loadMembers, closeMemberSheet]);

  // ── 출석 이력 열기 (멤버 탭) ──
  const openHistory = useCallback(
    async (member: { userId: string; name: string }) => {
      if (!clubId) return;
      setHistoryMember(member);
      setHistory(null);
      setHistoryLoading(true);
      try {
        const { data } = await clubApi.getMemberAttendance(clubId, member.userId);
        setHistory(data);
      } catch (err: any) {
        showAlert(Strings.common.error, err?.response?.data?.error || '출석 이력을 불러오지 못했어요');
        setHistoryMember(null);
      } finally {
        setHistoryLoading(false);
      }
    },
    [clubId],
  );

  // ── 회비: 정산 로드 (월이 바뀔 때마다) ──
  const loadDues = useCallback(
    async (period: string) => {
      if (!clubId) return;
      setDuesLoading(true);
      try {
        const { data } = await clubApi.getDues(clubId, period);
        setDues(data);
      } catch {
        setDues(null);
      } finally {
        setDuesLoading(false);
      }
    },
    [clubId],
  );

  // 회비 UI는 전용 화면(/club/[id]/money)으로 이전 — 여기서는 더 이상 로드하지 않음.
  // (구 상태/핸들러는 하위호환용으로 남아있으나 미사용.)

  // ── 회비: 월 회비 표준 금액 설정/수정 (클럽 PATCH) ──
  const handleSaveDuesAmount = useCallback(async () => {
    if (!clubId) return;
    const amount = Number(duesAmountInput.replace(/[^0-9]/g, ''));
    if (!amount || amount <= 0) {
      showAlert('알림', '회비 금액을 입력해 주세요');
      return;
    }
    setDuesAmountSaving(true);
    try {
      await clubApi.updateClub(clubId, { monthlyDuesAmount: amount });
      await fetchClubs();
      await loadDues(duesPeriod);
      setDuesAmountInput('');
      showSuccess('월 회비 금액을 설정했어요');
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '저장에 실패했습니다');
    } finally {
      setDuesAmountSaving(false);
    }
  }, [clubId, duesAmountInput, fetchClubs, loadDues, duesPeriod]);

  // ── 회비: 월 이동 (이전/다음 달) ──
  const shiftMonth = useCallback((delta: number) => {
    setDuesPeriod((prev) => {
      const [y, m] = prev.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  // ── 회비: 한 회원 납부/미납 토글 (optimistic + 서버 반영) ──
  const toggleDuesPaid = useCallback(
    async (item: { userId: string; paid: boolean }) => {
      if (!clubId || duesBusyUserId) return;
      setDuesBusyUserId(item.userId);
      const nextPaid = !item.paid;
      // Optimistic: 즉시 토글 + totals 추정 갱신.
      setDues((prev) => {
        if (!prev) return prev;
        const standard = prev.monthlyDuesAmount ?? 0;
        const items = prev.items.map((it) =>
          it.userId === item.userId ? { ...it, paid: nextPaid, amount: nextPaid ? standard : standard } : it,
        );
        const paid = items.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
        const paidCount = items.filter((i) => i.paid).length;
        return {
          ...prev,
          items,
          totals: {
            ...prev.totals,
            paid,
            unpaid: prev.totals.expected - paid,
            paidCount,
            unpaidCount: items.length - paidCount,
          },
        };
      });
      try {
        const { data } = await clubApi.setDues(clubId, {
          userId: item.userId,
          period: duesPeriod,
          paid: nextPaid,
        });
        setDues(data); // 서버 권위값으로 동기화.
      } catch (err: any) {
        showAlert(Strings.common.error, err?.response?.data?.error || '회비 처리에 실패했습니다');
        await loadDues(duesPeriod); // 롤백.
      } finally {
        setDuesBusyUserId(null);
      }
    },
    [clubId, duesBusyUserId, duesPeriod, loadDues],
  );

  // 회비 월 라벨 ("2026년 6월").
  const duesMonthLabel = useMemo(() => {
    const [y, m] = duesPeriod.split('-').map(Number);
    return `${y}년 ${m}월`;
  }, [duesPeriod]);

  // 검색 필터 + 운영진/회원 그룹핑 (운영진이 위로).
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const base = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
    const rank = (r: string) => (r === 'LEADER' ? 0 : r === 'STAFF' ? 1 : 2);
    return [...base].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
  }, [members, memberSearch]);

  const staffCount = useMemo(
    () => members.filter((m) => m.role === 'LEADER' || m.role === 'STAFF').length,
    [members],
  );

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <BackButton
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))}
      />
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
        {club?.name ? `${club.name} 관리` : '모임 관리'}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  // 로딩 중(아직 club/시설 미확정).
  if (loading && !club) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {Header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // 권한 없음 — 일반 멤버 / 비멤버가 직접 진입한 경우.
  if (!isStaff) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {Header}
        <View style={styles.center}>
          <Icon name="warning" size={40} color={colors.textLight} />
          <Text style={[styles.noPermTitle, { color: colors.text }]}>권한이 없어요</Text>
          <Text style={[styles.noPermSub, { color: colors.textSecondary }]}>
            모임 운영진만 관리 화면을 볼 수 있어요
          </Text>
          <TouchableOpacity
            style={[styles.backLink, { backgroundColor: colors.primary }]}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))}
            activeOpacity={0.85}
          >
            <Text style={styles.backLinkText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {Header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenContainer maxWidth={760} style={styles.content}>
        {/* ── 클럽 정보 ─────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="club" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>클럽 정보</Text>
          </View>

          {/* 모임 유형 — 정기 클럽(풀기능) / 번개 모임(라이트). 레슨 등 노출이 달라진다. */}
          <View style={{ marginBottom: spacing.md }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 0 }]}>모임 유형</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              {([
                { key: 'CLUB' as const, title: '정기 클럽', desc: '레슨·정기회비·게스트 풀기능' },
                { key: 'MEETUP' as const, title: '번개 모임', desc: '가볍게 모여 치기·엔빵 정산' },
              ]).map((t) => {
                const active = clubType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    disabled={clubTypeSaving || active}
                    onPress={async () => {
                      if (!clubId) return;
                      setClubTypeSaving(true);
                      try {
                        await clubApi.updateClub(clubId, { clubType: t.key });
                        setClubType(t.key);
                        await fetchClubs();
                        showSuccess(t.key === 'CLUB' ? '정기 클럽으로 전환했어요 — 레슨 기능이 열려요' : '번개 모임으로 전환했어요');
                      } catch (err: any) {
                        showAlert(Strings.common.error, err?.response?.data?.error || '변경에 실패했습니다');
                      } finally {
                        setClubTypeSaving(false);
                      }
                    }}
                    style={{
                      flex: 1, borderRadius: 12, padding: spacing.md, gap: 2,
                      backgroundColor: active ? colors.primary : colors.background,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : colors.text }}>{t.title}</Text>
                    <Text style={{ fontSize: 10, lineHeight: 14, color: active ? 'rgba(255,255,255,0.85)' : colors.textLight }}>{t.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 모임 공개 여부 — PUBLIC이면 '모임 찾기'에 노출(게스트 신청 가능). 토글 즉시 저장. */}
          <View style={styles.visibilityRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 0 }]}>모임 공개</Text>
              <Text style={[styles.fieldHint, { color: colors.textLight }]}>
                {visibility === 'PUBLIC'
                  ? '모임 찾기에 노출돼요 — 누구나 게스트 신청 가능'
                  : '숨김 상태 — 초대코드·공유 링크로만 접근돼요'}
              </Text>
            </View>
            <TouchableOpacity
              disabled={visibilitySaving}
              onPress={async () => {
                if (!clubId) return;
                const next = visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
                setVisibilitySaving(true);
                try {
                  await clubApi.updateClub(clubId, { visibility: next });
                  setVisibility(next);
                  await fetchClubs();
                  showSuccess(next === 'PUBLIC' ? '모임을 공개했어요 — 모임 찾기에 노출돼요' : '모임을 비공개로 전환했어요');
                } catch (err: any) {
                  showAlert(Strings.common.error, err?.response?.data?.error || '변경에 실패했습니다');
                } finally {
                  setVisibilitySaving(false);
                }
              }}
              style={[
                styles.visibilityBtn,
                visibility === 'PUBLIC'
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border },
                visibilitySaving && { opacity: 0.5 },
              ]}
              accessibilityLabel="모임 공개 전환"
            >
              <Text style={[styles.visibilityBtnText, { color: visibility === 'PUBLIC' ? '#fff' : colors.textSecondary }]}>
                {visibility === 'PUBLIC' ? '공개 중' : '비공개'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 모임 이름 */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>모임 이름</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            value={name}
            onChangeText={setName}
            placeholder="모임 이름"
            placeholderTextColor={colors.textLight}
            maxLength={50}
            accessibilityLabel="모임 이름"
          />

          {/* 홈 시설 (picker — 가로 스크롤 칩) */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: spacing.lg }]}>
            홈 시설
          </Text>
          <Text style={[styles.fieldHint, { color: colors.textLight }]}>
            정모를 시작할 때 기본으로 선택되는 시설이에요
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {/* 선택 안 함 칩 */}
            <FacilityChip
              label="선택 안 함"
              selected={homeFacilityId == null}
              onPress={() => setHomeFacilityId(null)}
              colors={colors}
            />
            {facilities.map((f) => (
              <FacilityChip
                key={f.id}
                label={f.name}
                selected={homeFacilityId === f.id}
                onPress={() => setHomeFacilityId(f.id)}
                colors={colors}
              />
            ))}
            {/* 운영자: 새 장소(체육관) 추가 */}
            <TouchableOpacity
              style={[styles.chip, styles.chipAdd, { borderColor: colors.primary }]}
              onPress={() => setShowAddFacility(true)}
              activeOpacity={0.7}
              accessibilityLabel="장소 추가"
            >
              <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>
                + 장소 추가
              </Text>
            </TouchableOpacity>
          </ScrollView>

          <AddFacilityModal
            visible={showAddFacility}
            onClose={() => setShowAddFacility(false)}
            onCreated={handleFacilityCreated}
          />

          {/* 소개 / description */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: spacing.lg }]}>
            소개
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.multiline,
              { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder="모임을 소개해 주세요 (선택)"
            placeholderTextColor={colors.textLight}
            maxLength={500}
            multiline
            textAlignVertical="top"
            accessibilityLabel="모임 소개"
          />
          <Text style={[styles.counter, { color: colors.textLight }]}>{description.length}/500</Text>

          <View style={styles.saveRow}>
            <Button title="저장" onPress={handleSave} variant="primary" size="md" loading={saving} />
          </View>
        </View>

        {/* ── 초대코드 / QR ─────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="qr" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>초대코드 / QR</Text>
          </View>

          <View style={[styles.codeBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.codeLabel, { color: colors.textSecondary }]}>현재 초대코드</Text>
            <Text style={[styles.codeValue, { color: colors.text }]}>{inviteCode || '—'}</Text>
          </View>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push(`/club/${clubId}/qr`)}
            activeOpacity={0.7}
            accessibilityLabel="모임 참여 QR 보기"
          >
            <Icon name="qr" size={18} color={colors.textSecondary} />
            <Text style={[styles.linkRowText, { color: colors.text }]}>모임 참여 QR 보기</Text>
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.regenBtn, { borderColor: colors.border }]}
            onPress={handleRegenerate}
            disabled={regenerating}
            activeOpacity={0.7}
            accessibilityLabel="초대코드 재발급"
          >
            {regenerating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="requeue" size={16} color={colors.primary} />
            )}
            <Text style={[styles.regenBtnText, { color: colors.primary }]}>초대코드 재발급</Text>
          </TouchableOpacity>
          <Text style={[styles.fieldHint, { color: colors.textLight }]}>
            재발급하면 기존 코드·QR·링크는 사용할 수 없게 돼요
          </Text>
        </View>

        {/* ── 멤버·운영진 ───────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="people" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>멤버·운영진</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.memberCount, { color: colors.textSecondary }]}>
              운영진 {staffCount} · 전체 {members.length}
            </Text>
          </View>
          <Text style={[styles.fieldHint, { color: colors.textLight }]}>
            {isLeader
              ? '멤버를 눌러 역할·급수를 바꾸거나 내보낼 수 있어요'
              : '멤버를 눌러 급수를 바꿀 수 있어요'}
          </Text>

          {/* 검색 */}
          {members.length > 5 && (
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border, marginTop: spacing.sm },
              ]}
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder="이름으로 검색"
              placeholderTextColor={colors.textLight}
              accessibilityLabel="멤버 검색"
            />
          )}

          {membersLoading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : filteredMembers.length === 0 ? (
            <Text style={[styles.placeholder, { color: colors.textLight }]}>
              {memberSearch.trim() ? '검색 결과가 없어요' : '아직 멤버가 없어요'}
            </Text>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {filteredMembers.map((m) => {
                const isMe = m.userId === myUserId;
                // LEADER(역할/내보내기) 또는 STAFF(급수)면 탭 가능. LEADER 행은 탭해도
                // 역할/내보내기 불가하지만 LEADER/STAFF 가 급수는 편집 가능.
                const canTap = isStaff;
                return (
                  <TouchableOpacity
                    key={m.userId}
                    style={[styles.memberRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      if (!canTap) return;
                      setActionMember(m);
                      setEditMode(null);
                    }}
                    activeOpacity={canTap ? 0.6 : 1}
                    accessibilityLabel={`${m.name} 멤버 관리`}
                  >
                    <View
                      style={[
                        styles.memberAvatar,
                        { backgroundColor: m.isCheckedIn ? colors.primary : colors.background, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.memberAvatarText, { color: m.isCheckedIn ? '#fff' : colors.textSecondary }]}>
                        {m.name[0]}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.memberNameRow}>
                        <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                          {m.name}
                        </Text>
                        {isMe && <Text style={[styles.meBadge, { color: colors.textLight }]}>(나)</Text>}
                      </View>
                      <Text style={[styles.memberSub, { color: colors.textSecondary }]}>
                        급수 {m.skillLevel ?? '미설정'}
                      </Text>
                    </View>
                    <RoleBadge role={m.role} colors={colors} />
                    {canTap && <Icon name="chevronRight" size={18} color={colors.textLight} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* ── 출석 ──────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="checkin" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>출석</Text>
          </View>
          <Text style={[styles.fieldHint, { color: colors.textLight }]}>
            출석왕 순위예요. 아래 멤버를 누르면 참여한 정모 이력을 볼 수 있어요
          </Text>

          {/* 출석왕 리더보드 (이번 달/올해/전체) */}
          {clubId && <AttendanceLeaderboard clubId={clubId} maxRows={5} />}

          {/* 게스트 기록 연결 — 현장 게스트 참가 기록을 멤버 계정으로 이관 */}
          <TouchableOpacity
            style={[styles.guestMergeBtn, { borderColor: colors.border }]}
            onPress={() => router.push(`/club/${clubId}/guest-merge`)}
            activeOpacity={0.7}
            accessibilityLabel="게스트 기록 연결 열기"
          >
            <Icon name="link" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.guestMergeTitle, { color: colors.text }]}>게스트 기록 연결</Text>
              <Text style={[styles.guestMergeHint, { color: colors.textLight }]} numberOfLines={2}>
                게스트로 참가해 출석왕에 안 잡히는 멤버의 기록을 계정에 합쳐요
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </TouchableOpacity>

          {/* 멤버별 이력 — 멤버를 눌러 그 회원이 참여한 정모 목록을 본다 */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: spacing.lg }]}>
            멤버별 출석 이력
          </Text>
          {membersLoading ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : members.length === 0 ? (
            <Text style={[styles.placeholder, { color: colors.textLight }]}>아직 멤버가 없어요</Text>
          ) : (
            <View style={{ marginTop: spacing.xs }}>
              {filteredMembers.map((m) => (
                <TouchableOpacity
                  key={m.userId}
                  style={[styles.memberRow, { borderBottomColor: colors.border }]}
                  onPress={() => openHistory({ userId: m.userId, name: m.name })}
                  activeOpacity={0.6}
                  accessibilityLabel={`${m.name} 출석 이력 보기`}
                >
                  <View style={[styles.memberAvatar, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.memberAvatarText, { color: colors.textSecondary }]}>{m.name[0]}</Text>
                  </View>
                  <Text style={[styles.memberName, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={[styles.historyCue, { color: colors.textLight }]}>이력</Text>
                  <Icon name="chevronRight" size={18} color={colors.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── 운영 정보 (운동 일정·게스트 신청 정책 — 전용 화면) ── */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}
          onPress={() => router.push(`/club/${clubId}/operation`)}
          activeOpacity={0.7}
          accessibilityLabel="운영 정보 열기"
        >
          <View style={styles.cardHeader}>
            <Icon name="calendar" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>운영 정보</Text>
            <View style={{ flex: 1 }} />
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
            정기 운동 요일·시간을 정하고, 게스트 신청 가능 요일·마감·하루 정원을 관리해요
          </Text>
        </TouchableOpacity>

        {/* ── 회비 관리 (정산·게스트·설정 — 전용 화면) ── */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}
          onPress={() => router.push(`/club/${clubId}/money`)}
          activeOpacity={0.7}
          accessibilityLabel="회비 관리 열기"
        >
          <View style={styles.cardHeader}>
            <Icon name="medal" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>회비 관리</Text>
            <View style={{ flex: 1 }} />
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
            정기 회비(매달·분기·반기·연) · 정모 참가비 · 대관비 엔빵 · 게스트비를 자동 정산하고,
            게스트 사전 신청을 받고, 입금확인을 원클릭으로 관리해요
          </Text>
        </TouchableOpacity>

        {/* ── 레슨 (개설·신청 확정 — 전용 화면) ── */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}
          onPress={() => router.push(`/club/${clubId}/lessons`)}
          activeOpacity={0.7}
          accessibilityLabel="레슨 관리 열기"
        >
          <View style={styles.cardHeader}>
            <Icon name="court" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>레슨</Text>
            <View style={{ flex: 1 }} />
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
            코치·요일·시간·정원으로 레슨을 개설하고, 회원 신청을 확정해요
          </Text>
        </TouchableOpacity>

        {/* ── 게스트 문의함 (게스트 ↔ 운영진 채팅) ── */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}
          onPress={() => router.push(`/club/${clubId}/guest-inbox`)}
          activeOpacity={0.7}
          accessibilityLabel="게스트 문의함 열기"
        >
          <View style={styles.cardHeader}>
            <Icon name="chat" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>게스트 문의</Text>
            {guestUnread > 0 && (
              <View style={{ backgroundColor: colors.danger, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 6 }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{guestUnread}</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Icon name="chevronRight" size={18} color={colors.textLight} />
          </View>
          <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
            게스트 신청 페이지에서 들어온 문의에 1:1로 답장해요 (비회원도 대화 가능)
          </Text>
        </TouchableOpacity>

        {/* ── 모임 삭제 (danger, 맨 아래) ───────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="warning" size={18} color={colors.danger} />
            <Text style={[styles.cardTitle, { color: colors.danger }]}>모임 삭제</Text>
          </View>
          <Text style={[styles.fieldHint, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            모임과 모든 정모·출석·게임 기록이 영구 삭제돼요. 되돌릴 수 없어요.
          </Text>
          <TouchableOpacity
            style={[styles.deleteBtn, { borderColor: colors.danger }]}
            onPress={handleDelete}
            activeOpacity={0.7}
            accessibilityLabel="모임 삭제"
          >
            <Icon name="delete" size={16} color={colors.danger} />
            <Text style={[styles.deleteBtnText, { color: colors.danger }]}>모임 삭제</Text>
          </TouchableOpacity>
        </View>
        </ScreenContainer>
      </ScrollView>

      {/* ── 멤버 액션 시트 (역할 / 급수 / 내보내기) ───────────── */}
      <Modal
        visible={!!actionMember}
        transparent
        animationType="fade"
        onRequestClose={closeMemberSheet}
      >
        <TouchableOpacity
          style={[styles.sheetOverlay, isTablet && styles.sheetOverlayCentered]}
          activeOpacity={1}
          onPress={closeMemberSheet}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheet, isTablet && styles.sheetCentered, { backgroundColor: colors.surface }]}
            onPress={() => {}}
          >
            {actionMember && (
              <>
                {/* 헤더 — 멤버 요약 */}
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetName, { color: colors.text }]} numberOfLines={1}>
                    {actionMember.name}
                  </Text>
                  <RoleBadge role={actionMember.role} colors={colors} />
                </View>
                <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>
                  현재 급수 {actionMember.skillLevel ?? '미설정'}
                </Text>

                {/* 역할 변경 패널 (LEADER 전용, 본인·다른 LEADER 제외) */}
                {editMode === 'role' ? (
                  <View style={styles.sheetPanel}>
                    <Text style={[styles.sheetPanelTitle, { color: colors.textSecondary }]}>역할 변경</Text>
                    {ROLE_OPTIONS.map((opt) => {
                      const active = actionMember.role === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[
                            styles.optionRow,
                            { borderColor: active ? colors.primary : colors.border },
                            active && { backgroundColor: colors.primaryBg },
                          ]}
                          onPress={() => handleChangeRole(opt.value)}
                          disabled={active || memberBusy}
                          activeOpacity={0.7}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionLabel, { color: active ? colors.primary : colors.text }]}>
                              {opt.label}
                            </Text>
                            <Text style={[styles.optionDesc, { color: colors.textLight }]}>{opt.desc}</Text>
                          </View>
                          {active && <Icon name="success" size={18} color={colors.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : editMode === 'skill' ? (
                  <View style={styles.sheetPanel}>
                    <Text style={[styles.sheetPanelTitle, { color: colors.textSecondary }]}>
                      급수 편집 (이 모임 전용)
                    </Text>
                    <View style={styles.skillGrid}>
                      {SKILL_OPTIONS.map((s) => {
                        const active = actionMember.skillLevel === s;
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.skillChip,
                              {
                                backgroundColor: active ? colors.primary : colors.background,
                                borderColor: active ? colors.primary : colors.border,
                              },
                            ]}
                            onPress={() => handleChangeSkill(s)}
                            disabled={active || memberBusy}
                            activeOpacity={0.7}
                            accessibilityLabel={`급수 ${s}`}
                          >
                            <Text style={[styles.skillChipText, { color: active ? '#fff' : colors.textSecondary }]}>
                              {s}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : editMode === 'gender' ? (
                  <View style={styles.sheetPanel}>
                    <Text style={[styles.sheetPanelTitle, { color: colors.textSecondary }]}>
                      성별 편집
                    </Text>
                    <View style={styles.skillGrid}>
                      {(['M', 'F'] as Gender[]).map((g) => {
                        const active = actionMember.gender === g;
                        const meta = GENDER_META[g];
                        return (
                          <TouchableOpacity
                            key={g}
                            style={[
                              styles.genderChip,
                              {
                                backgroundColor: active ? meta.color : colors.background,
                                borderColor: active ? meta.color : colors.border,
                              },
                            ]}
                            onPress={() => handleChangeGender(g)}
                            disabled={active || memberBusy}
                            activeOpacity={0.7}
                            accessibilityLabel={`성별 ${meta.label}`}
                          >
                            <GenderMarker meta={meta} size={20} color={active ? '#fff' : meta.color} />
                            <Text style={[styles.genderChipText, { color: active ? '#fff' : colors.textSecondary }]}>
                              {meta.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  // 액션 메뉴 (기본)
                  <View style={styles.sheetActions}>
                    {/* 역할 변경 — LEADER 만, 본인/다른 LEADER 는 불가 */}
                    {isLeader && actionMember.role !== 'LEADER' && (
                      <SheetAction
                        icon="admin"
                        label="역할 변경"
                        sub={actionMember.role === 'STAFF' ? '운영진 → 회원으로' : '운영진으로 지정'}
                        colors={colors}
                        onPress={() => setEditMode('role')}
                      />
                    )}
                    {/* 급수 편집 — LEADER/STAFF */}
                    <SheetAction
                      icon="star"
                      label="급수 편집"
                      sub="이 모임에서만 적용돼요"
                      colors={colors}
                      onPress={() => setEditMode('skill')}
                    />
                    {/* 성별 편집 — LEADER/STAFF */}
                    <SheetAction
                      icon="person"
                      label="성별 편집"
                      sub={
                        actionMember.gender === 'M'
                          ? '현재 남'
                          : actionMember.gender === 'F'
                            ? '현재 여'
                            : '성별 미설정'
                      }
                      colors={colors}
                      onPress={() => setEditMode('gender')}
                    />
                    {/* 내보내기 — LEADER 만, 본인/다른 LEADER 는 불가 */}
                    {isLeader &&
                      actionMember.role !== 'LEADER' &&
                      actionMember.userId !== myUserId && (
                        <SheetAction
                          icon="delete"
                          label="내보내기"
                          sub="모임에서 제외해요"
                          danger
                          colors={colors}
                          onPress={handleRemoveMember}
                        />
                      )}
                  </View>
                )}

                {memberBusy && (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={{ marginTop: spacing.sm }}
                  />
                )}

                <TouchableOpacity
                  style={[styles.sheetClose, { borderColor: colors.border }]}
                  onPress={editMode ? () => setEditMode(null) : closeMemberSheet}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sheetCloseText, { color: colors.textSecondary }]}>
                    {editMode ? '뒤로' : Strings.common.cancel}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── 출석 이력 모달 (멤버가 참여한 정모 목록) ─────────────── */}
      <Modal
        visible={!!historyMember}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryMember(null)}
      >
        <TouchableOpacity
          style={[styles.sheetOverlay, isTablet && styles.sheetOverlayCentered]}
          activeOpacity={1}
          onPress={() => setHistoryMember(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheet, isTablet && styles.sheetCentered, { backgroundColor: colors.surface }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetName, { color: colors.text }]} numberOfLines={1}>
                {historyMember?.name} 출석 이력
              </Text>
              <TouchableOpacity onPress={() => setHistoryMember(null)} hitSlop={10}>
                <Icon name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>
              이 모임에서 참여한 정모 {history?.count ?? 0}회
            </Text>

            {historyLoading ? (
              <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : !history || history.sessions.length === 0 ? (
              <Text style={[styles.placeholder, { color: colors.textLight }]}>
                아직 참여한 정모가 없어요
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {history.sessions.map((s) => (
                  <View key={s.sessionId} style={[styles.historyRow, { borderBottomColor: colors.border }]}>
                    <Icon name="calendar" size={16} color={colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyTitle, { color: colors.text }]} numberOfLines={1}>
                        {s.title || '정모'}
                      </Text>
                      <Text style={[styles.historyDate, { color: colors.textSecondary }]}>
                        {formatSessionDate(s.startedAt)}
                        {s.checkedInAt ? ` · ${formatCheckInTime(s.checkedInAt)} 체크인` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.sheetClose, { borderColor: colors.border }]}
              onPress={() => setHistoryMember(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetCloseText, { color: colors.textSecondary }]}>닫기</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// 정모 날짜 포맷 ("2026. 6. 24. (수)").
function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${days[d.getDay()]})`;
}

// 체크인 시각 포맷 ("오후 7:23").
function formatCheckInTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${m}`;
}

// 역할 배지 (대표/운영진/회원).
function RoleBadge({ role, colors }: { role: string; colors: any }) {
  const isLeader = role === 'LEADER';
  const isStaff = role === 'STAFF';
  const bg = isLeader ? colors.primaryBg : colors.surface2;
  const fg = isLeader ? colors.primary : colors.textSecondary;
  return (
    <View style={[styles.roleBadge, { backgroundColor: bg }]}>
      <Text style={[styles.roleBadgeText, { color: fg }]}>{ROLE_LABELS[role] ?? role}</Text>
    </View>
  );
}

// 액션 시트 메뉴 항목.
function SheetAction({
  icon,
  label,
  sub,
  onPress,
  colors,
  danger,
}: {
  icon: any;
  label: string;
  sub: string;
  onPress: () => void;
  colors: any;
  danger?: boolean;
}) {
  const tint = danger ? colors.danger : colors.text;
  return (
    <TouchableOpacity style={styles.sheetActionRow} onPress={onPress} activeOpacity={0.6}>
      <Icon name={icon} size={20} color={danger ? colors.danger : colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.sheetActionLabel, { color: tint }]}>{label}</Text>
        <Text style={[styles.sheetActionSub, { color: colors.textLight }]}>{sub}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.textLight} />
    </TouchableOpacity>
  );
}

// 홈 시설 선택 칩
function FacilityChip({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={`홈 시설 ${label}`}
    >
      <Text
        style={[styles.chipText, { color: selected ? '#fff' : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  // ScrollView content host — grows to fit; ScreenContainer centers on wide.
  scrollContent: { flexGrow: 1 },
  // Inner (ScreenContainer) column padding/gap for the form sections.
  content: { padding: spacing.lg, paddingBottom: spacing.xxxxl, gap: spacing.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  headerTitle: { ...typography.subtitle1, flex: 1 },
  headerSpacer: { width: 40 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  noPermTitle: { ...typography.h3 },
  noPermSub: { ...typography.body2, textAlign: 'center' },
  backLink: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  backLinkText: { ...typography.subtitle2, color: '#fff' },

  card: { borderRadius: radius.card, padding: spacing.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  cardTitle: { ...typography.subtitle2 },

  visibilityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  visibilityBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  visibilityBtnText: { ...typography.buttonSm, fontWeight: '600' },
  fieldLabel: { ...typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  fieldHint: { ...typography.caption, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'web' ? spacing.md : spacing.sm,
    ...typography.body1,
  },
  multiline: { minHeight: 88, paddingTop: spacing.sm },
  counter: { ...typography.caption, alignSelf: 'flex-end', marginTop: spacing.xs },

  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.md },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 180,
  },
  chipText: { ...typography.body2, fontWeight: '600' },
  chipAdd: { borderStyle: 'dashed' },

  saveRow: { marginTop: spacing.lg, alignItems: 'flex-end' },

  codeBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  codeLabel: { ...typography.caption },
  codeValue: { ...typography.h2, letterSpacing: 4, fontWeight: '600', marginTop: 2 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  linkRowText: { ...typography.body1, flex: 1 },

  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  regenBtnText: { ...typography.subtitle2 },

  placeholder: { ...typography.body2, paddingVertical: spacing.sm },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
  },
  deleteBtnText: { ...typography.subtitle2 },

  // ── 게스트 기록 연결 진입 ──
  guestMergeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  guestMergeTitle: { fontSize: 13, fontWeight: '600' },
  guestMergeHint: { fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 15 },

  // ── 멤버·운영진 ──
  memberCount: { ...typography.caption },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { ...typography.subtitle2, fontWeight: '700' },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  memberName: { ...typography.body1, fontWeight: '600', flexShrink: 1 },
  meBadge: { ...typography.caption },
  memberSub: { ...typography.caption, marginTop: 1 },
  roleBadge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  roleBadgeText: { ...typography.caption, fontWeight: '700' },

  // ── 액션 시트 ──
  // Phone: bottom-sheet (flex-end). Tablet/desktop: centered dialog.
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetOverlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sheetCentered: {
    width: '100%',
    maxWidth: 480,
    borderRadius: radius.xl,
    paddingBottom: spacing.lg,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetName: { ...typography.h3, flexShrink: 1 },
  sheetSub: { ...typography.body2, marginTop: spacing.xs, marginBottom: spacing.md },
  sheetActions: { gap: spacing.xs },
  sheetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  sheetActionLabel: { ...typography.body1, fontWeight: '600' },
  sheetActionSub: { ...typography.caption, marginTop: 1 },
  sheetPanel: { marginTop: spacing.xs, gap: spacing.sm },
  sheetPanelTitle: { ...typography.caption, fontWeight: '700' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionLabel: { ...typography.subtitle2 },
  optionDesc: { ...typography.caption, marginTop: 1 },
  skillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  skillChip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillChipText: { ...typography.subtitle1, fontWeight: '600' },
  // 성별 편집 chip: vector marker + 남/여 label (auto width so both fit).
  genderChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1.5,
  },
  genderChipText: { ...typography.subtitle1, fontWeight: '600' },
  sheetClose: {
    marginTop: spacing.lg,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sheetCloseText: { ...typography.subtitle2 },

  // ── 출석 이력 ──
  historyCue: { ...typography.caption, fontWeight: '600' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyTitle: { ...typography.body1, fontWeight: '600' },
  historyDate: { ...typography.caption, marginTop: 1 },

  // ── 회비 ──
  duesAmountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.xs,
  },
  monthBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: { ...typography.subtitle1, fontWeight: '700', minWidth: 110, textAlign: 'center' },
  duesTotals: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  duesTotalItem: { flex: 1, alignItems: 'center', gap: 2 },
  duesTotalLabel: { ...typography.caption },
  duesTotalValue: { ...typography.subtitle2, fontWeight: '600' },
  duesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  duesAmount: { ...typography.caption, fontWeight: '600' },
  paidToggle: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 72,
    alignItems: 'center',
  },
  paidToggleText: { ...typography.caption, fontWeight: '600' },
});

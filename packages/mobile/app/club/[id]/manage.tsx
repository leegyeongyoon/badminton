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
import { clubApi, ClubMemberResponse } from '../../../services/club';
import { facilityApi } from '../../../services/facility';
import { showAlert, showConfirm } from '../../../utils/alert';
import { showSuccess } from '../../../utils/feedback';
import { Strings } from '../../../constants/strings';
import { typography, spacing, radius } from '../../../constants/theme';

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
  const { colors, shadows } = useTheme();
  const { clubs, fetchClubs, deleteClub } = useClubStore();
  const myUserId = useAuthStore((s) => s.user?.id);

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
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 멤버·운영진 섹션 상태.
  const [members, setMembers] = useState<ClubMemberResponse[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberSearch, setMemberSearch] = useState('');
  // 선택된 멤버의 액션 시트(역할/급수/내보내기). null 이면 닫힘.
  const [actionMember, setActionMember] = useState<ClubMemberResponse | null>(null);
  // 'role' | 'skill' | null — 액션 시트 안에서 어떤 편집 패널을 보여줄지.
  const [editMode, setEditMode] = useState<'role' | 'skill' | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

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
  }, [club?.id, club?.name, club?.description, club?.homeFacilityId, club?.inviteCode]);

  // 시설 목록 (홈 시설 선택용).
  useEffect(() => {
    let alive = true;
    facilityApi
      .list()
      .then(({ data }) => {
        if (alive) setFacilities(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* silent — 시설 목록 없어도 나머지는 동작 */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 클럽 정보 ─────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="club" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>클럽 정보</Text>
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
          </ScrollView>

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

        {/* ── 출석 (다음 Part) ──────────────────────── */}
        <PlaceholderSection icon="checkin" title="출석" colors={colors} shadows={shadows} />

        {/* ── 회비 (다음 Part) ──────────────────────── */}
        <PlaceholderSection icon="medal" title="회비" colors={colors} shadows={shadows} />

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
      </ScrollView>

      {/* ── 멤버 액션 시트 (역할 / 급수 / 내보내기) ───────────── */}
      <Modal
        visible={!!actionMember}
        transparent
        animationType="fade"
        onRequestClose={closeMemberSheet}
      >
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={closeMemberSheet}>
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheet, { backgroundColor: colors.surface }]}
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
                            active && { backgroundColor: colors.primary + '14' },
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
    </View>
  );
}

// 역할 배지 (대표/운영진/회원).
function RoleBadge({ role, colors }: { role: string; colors: any }) {
  const isLeader = role === 'LEADER';
  const isStaff = role === 'STAFF';
  const bg = isLeader ? colors.primary + '1A' : isStaff ? colors.warning + '1A' : colors.border;
  const fg = isLeader ? colors.primary : isStaff ? colors.warning : colors.textSecondary;
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

// 다음 Part 에서 채울 섹션 자리표시자.
function PlaceholderSection({
  icon,
  title,
  colors,
  shadows,
}: {
  icon: any;
  title: string;
  colors: any;
  shadows: any;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
      <View style={styles.cardHeader}>
        <Icon name={icon} size={18} color={colors.textSecondary} />
        <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.placeholder, { color: colors.textLight }]}>곧 추가됩니다</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
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

  saveRow: { marginTop: spacing.lg, alignItems: 'flex-end' },

  codeBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  codeLabel: { ...typography.caption },
  codeValue: { ...typography.h2, letterSpacing: 4, fontWeight: '800', marginTop: 2 },

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
    borderRadius: 18,
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
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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
  skillChipText: { ...typography.subtitle1, fontWeight: '800' },
  sheetClose: {
    marginTop: spacing.lg,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sheetCloseText: { ...typography.subtitle2 },
});

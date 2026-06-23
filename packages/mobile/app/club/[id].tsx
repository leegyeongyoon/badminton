import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { clubSessionApi, ClubSessionListItem } from '../../services/clubSession';
import { facilityApi } from '../../services/facility';
import { Colors } from '../../constants/colors';
import { createShadow } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { getItem, setItem } from '../../services/storage';
import { AttendanceLeaderboard } from '../../components/club/AttendanceLeaderboard';
import { Icon } from '../../components/ui/Icon';

interface ClubMember {
  userId: string;
  name: string;
  role: string;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: string | null;
}

const playerStatusColors: Record<string, string> = {
  AVAILABLE: Colors.playerAvailable,
  IN_TURN: Colors.playerInTurn,
  RESTING: Colors.playerResting,
};

const playerStatusLabels: Record<string, string> = {
  AVAILABLE: Strings.player.status.AVAILABLE,
  IN_TURN: Strings.player.status.IN_TURN,
  RESTING: Strings.player.status.RESTING,
};

const roleLabels: Record<string, string> = {
  LEADER: '대표',
  STAFF: '운영진',
  MEMBER: '회원',
};

// 날짜 헬퍼 (web-safe — Intl/Date만 사용, native 전용 API 없음).
// "6/19" 짧은 형태 (진행 중 정모 카드 제목용).
function fmtShortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
// "6월 19일 (목)" 형태 (지난 정모 목록용).
function fmtKoreanDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})`;
}

export default function ClubDetailScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentMembers, fetchMembers, clubs, fetchClubs } = useClubStore();
  const { status: checkinStatus, checkOut, fetchStatus, checkIn } = useCheckinStore();
  const { user, isGuest } = useAuthStore();

  const [checkingOut, setCheckingOut] = useState(false);

  const [activeSession, setActiveSession] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  // 이 모임의 정모 목록(최신순) — 진행 중 정모 + 지난 정모 이력.
  const [sessions, setSessions] = useState<ClubSessionListItem[]>([]);
  // 지난 정모 더보기: 처음엔 ~10개만, 누르면 전체.
  const [showAllPast, setShowAllPast] = useState(false);
  // 멤버 목록 섹션 접이식 — 평소 닫힘.
  const [showMembers, setShowMembers] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ClubMember | null>(null);
  // 정모 시작 시 등록할 "코트 수" (기본 4). 각 정모는 자기 전용 코트 1..N을 가진다.
  const [courtCountInput, setCourtCountInput] = useState('4');
  const [isStarting, setIsStarting] = useState(false);
  // 정모를 열 시설. 체크인 없이도 시작할 수 있도록 시설을 직접 고른다.
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);

  const club = clubs.find((c) => c.id === clubId);
  const myMembership = currentMembers.find((m) => m.userId === user?.id);
  const isLeaderOrStaff = myMembership?.role === 'LEADER' || myMembership?.role === 'STAFF';
  const isLeader = myMembership?.role === 'LEADER';
  const checkedInFacilityId = checkinStatus?.facilityId;
  // Am I currently checked in? Prefer the per-member flag from the club roster
  // (reflects this club's 정모), falling back to the global check-in status.
  const isCheckedIn = !!myMembership?.isCheckedIn || !!checkinStatus;
  // 정모를 시작할 시설: 명시 선택 > 체크인한 곳 > 클럽 홈 시설 > 첫 시설.
  // (체크인 여부와 무관하게 리더가 바로 시작할 수 있어야 한다.)
  const startFacilityId =
    selectedFacilityId ||
    checkedInFacilityId ||
    (club as any)?.homeFacilityId ||
    facilities[0]?.id ||
    null;
  const startFacilityName =
    facilities.find((f) => f.id === startFacilityId)?.name ||
    checkinStatus?.facilityName ||
    '';

  const loadActiveSession = useCallback(async () => {
    if (!clubId) return;
    setLoadingSession(true);
    try {
      const { data } = await clubSessionApi.getActive(clubId);
      setActiveSession(data);
    } catch {
      setActiveSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, [clubId]);

  // 이 모임의 정모 목록(최신순)을 불러온다 — 진행 중 + 지난 정모 이력.
  const loadSessions = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data } = await clubSessionApi.listSessions(clubId);
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    }
  }, [clubId]);

  useEffect(() => {
    if (clubId) {
      fetchMembers(clubId);
      loadActiveSession();
      loadSessions();
    }
  }, [clubId]);

  // Deep-link / web reload: the club roster (clubStore.clubs) is normally loaded
  // by the home screen. If we land here directly and this club isn't in the store,
  // fetch the list so the header + info card show the real 모임 NAME (not "모임").
  useEffect(() => {
    if (clubId && !clubs.find((c) => c.id === clubId)) {
      fetchClubs();
    }
  }, [clubId, clubs, fetchClubs]);

  // 운영판/요약에서 돌아오면 정모(진행 중·이력)를 새로고침 — 종료된 정모가 바로
  // 지난 정모 목록에 반영되도록. (멤버 목록은 기존 흐름 유지.)
  useFocusEffect(
    useCallback(() => {
      if (clubId) {
        loadActiveSession();
        loadSessions();
      }
    }, [clubId, loadActiveSession, loadSessions]),
  );

  // Facilities for the 정모 start (so a leader can start without checking in).
  useEffect(() => {
    facilityApi
      .list()
      .then(({ data }) => setFacilities(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Auto check-in on entering an ACTIVE 정모: a club member who opens the 정모 is
  // checked in automatically (NO geofence — per product decision). Done at most
  // ONCE per 정모 (persisted), so a member who later checks out is NOT auto
  // re-checked-in — they re-check-in with the manual 체크인 button. Guests and
  // non-members are excluded.
  const autoTriedRef = useRef<string | null>(null);
  const [autoCheckMsg] = useState<string | null>(null);
  const AUTO_ATTEND_KEY = 'badminton_auto_attended_sessions';
  useEffect(() => {
    const sid = activeSession?.id;
    if (!sid || !user || isGuest || isCheckedIn || !myMembership) return;
    if (autoTriedRef.current === sid) return;
    autoTriedRef.current = sid;
    (async () => {
      let done: string[] = [];
      try { done = JSON.parse((await getItem(AUTO_ATTEND_KEY)) || '[]'); } catch { done = []; }
      if (done.includes(sid)) return; // already auto-attended once (e.g. then checked out)
      try {
        await clubSessionApi.attend(sid); // unconditional check-in (no geofence)
        try { await setItem(AUTO_ATTEND_KEY, JSON.stringify([...done, sid])); } catch { /* noop */ }
        showSuccess('정모 참여 — 자동 체크인됐어요');
        await Promise.all([fetchStatus(), fetchMembers(clubId)]);
      } catch { /* non-fatal — 수동 체크인 버튼 유지 */ }
    })();
  }, [activeSession?.id, user, isGuest, isCheckedIn, myMembership, clubId]);

  const onRefresh = useCallback(async () => {
    if (clubId) {
      await Promise.all([
        fetchMembers(clubId),
        loadActiveSession(),
        loadSessions(),
      ]);
    }
  }, [clubId]);

  // Open the start modal to register the 코트 수 (default 4) for this 정모.
  // 체크인 없이도 열 수 있다 — 시설은 startFacilityId로 결정된다.
  const handleOpenStartModal = () => {
    setSelectedFacilityId(startFacilityId);
    setCourtCountInput('4');
    setShowStartModal(true);
  };

  // Start the 정모 with a court COUNT. The server creates this 정모's OWN courts
  // (코트 1 … 코트 N) — fully independent of any other 모임's courts.
  // 체크인은 필요 없다. 시설은 startFacilityId(선택>체크인>홈>첫 시설)로 정한다.
  const handleStartSession = async (courtCount?: number) => {
    const facilityId = startFacilityId;
    if (!clubId || !facilityId) {
      showAlert('알림', '시설 정보를 불러오는 중이에요. 잠시 후 다시 시도해 주세요');
      return;
    }
    setIsStarting(true);
    try {
      const { data: newSession } = await clubSessionApi.start(clubId, {
        facilityId,
        ...(courtCount && courtCount > 0 ? { courtCount } : {}),
      });
      setShowStartModal(false);
      setActiveSession(newSession);
      // 정모 시작하면 바로 운영판으로
      router.push(`/session/${newSession.id}/operate`);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '정모 시작에 실패했습니다');
    } finally {
      setIsStarting(false);
    }
  };

  // One-tap 정모 start: defaults to 4 courts (코트 1~4) for this 정모.
  // 여러 시설이 있으면 모달에서 고르도록 유도, 아니면 바로 시작.
  const handleQuickStartSession = async () => {
    if (facilities.length > 1 && !checkedInFacilityId && !(club as any)?.homeFacilityId) {
      handleOpenStartModal();
      return;
    }
    await handleStartSession(4);
  };

  // Player self check-out. Confirms, calls the existing checkinStore.checkOut()
  // (POST /checkin/checkout), then refreshes both the global check-in status and
  // this club's roster so the "참석 중" indicator / 체크인 button update.
  const handleCheckOut = () => {
    showConfirm(
      '체크아웃',
      '정모에서 체크아웃할까요? 대기 중인 순번은 취소됩니다.',
      async () => {
        setCheckingOut(true);
        try {
          await checkOut();
          await Promise.all([
            fetchStatus(),
            clubId ? fetchMembers(clubId) : Promise.resolve(),
          ]);
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.error || '체크아웃에 실패했습니다');
        } finally {
          setCheckingOut(false);
        }
      },
      '체크아웃',
      Strings.common.cancel,
      'danger',
    );
  };

  const handleChangeRole = async (newRole: string) => {
    if (!clubId || !selectedMember) return;
    try {
      await clubSessionApi.updateMemberRole(clubId, selectedMember.userId, newRole);
      setShowRoleModal(false);
      setSelectedMember(null);
      fetchMembers(clubId);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '역할 변경에 실패했습니다');
    }
  };

  const checkedInMembers = currentMembers.filter((m) => m.isCheckedIn);
  const notCheckedInMembers = currentMembers.filter((m) => !m.isCheckedIn);

  const renderMember = ({ item }: { item: ClubMember }) => (
    <TouchableOpacity
      style={styles.memberCard}
      onPress={() => {
        if (isLeader && item.userId !== user?.id) {
          setSelectedMember(item);
          setShowRoleModal(true);
        }
      }}
      activeOpacity={isLeader && item.userId !== user?.id ? 0.7 : 1}
    >
      <View style={[styles.memberAvatar, item.isCheckedIn && styles.memberAvatarActive]}>
        <Text style={[styles.avatarText, item.isCheckedIn && styles.avatarTextActive]}>
          {item.name[0]}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>{item.name}</Text>
          {item.userId === user?.id && (
            <Text style={styles.meBadge}> (나)</Text>
          )}
        </View>
        <View style={styles.memberMetaRow}>
          <View style={[styles.roleBadge, {
            backgroundColor: item.role === 'LEADER' ? Colors.warning + '20'
              : item.role === 'STAFF' ? '#7C3AED20'
              : Colors.divider,
          }]}>
            <Text style={[styles.roleBadgeText, {
              color: item.role === 'LEADER' ? Colors.warning
                : item.role === 'STAFF' ? '#7C3AED'
                : Colors.textLight,
            }]}>
              {roleLabels[item.role] || item.role}
            </Text>
          </View>
          {item.isCheckedIn && item.playerStatus && (
            <View style={[styles.statusBadge, {
              backgroundColor: (playerStatusColors[item.playerStatus] || Colors.textLight) + '20',
            }]}>
              <View style={[styles.statusDot, {
                backgroundColor: playerStatusColors[item.playerStatus] || Colors.textLight,
              }]} />
              <Text style={[styles.statusBadgeText, {
                color: playerStatusColors[item.playerStatus] || Colors.textLight,
              }]}>
                {playerStatusLabels[item.playerStatus] || item.playerStatus}
              </Text>
            </View>
          )}
        </View>
      </View>
      {/* 출석은 QR 스캔으로 자동 처리 — 명단은 읽기 전용. 운영진(LEADER)은
          멤버를 탭해 역할만 변경할 수 있다(체크인 토글 없음). */}
      {!item.isCheckedIn && <Text style={styles.offlineText}>오프라인</Text>}
      {isLeader && item.userId !== user?.id && (
        <Text style={styles.editHint}>...</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: club?.name || '모임',
          // Always render our own back so it survives a deep-link / web reload
          // (the Stack's auto back button disappears when there's no history).
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
              hitSlop={10}
              style={styles.headerBack}
              accessibilityLabel="뒤로가기"
              accessibilityRole="button"
            >
              <Icon name="chevronLeft" size={24} color={Colors.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={loadingSession} onRefresh={onRefresh} />}
        >
          {/* ─── 모임 정체성 (quiet, compact) ───
              avatar + 이름 + 멤버수 + 초대코드. 채팅/건의·QR은 작은 아이콘 액션으로
              demote (full-width 보라 버튼 stack 제거). */}
          {club && (
            <View style={styles.infoCard}>
              <View style={styles.infoTopRow}>
                <View style={styles.infoLeft}>
                  <View style={styles.clubAvatarLarge}>
                    <Text style={styles.clubAvatarText}>{club.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clubName} numberOfLines={1}>{club.name}</Text>
                    <Text style={styles.clubMeta}>멤버 {currentMembers.length}명</Text>
                  </View>
                </View>
                {/* 작은 아이콘 액션: 채팅/건의 + 모임 참여 QR(운영진만) */}
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    style={styles.iconAction}
                    onPress={() => router.push(`/club/${clubId}/chat`)}
                    activeOpacity={0.7}
                    accessibilityLabel="채팅 / 건의 (짝 요청)"
                  >
                    <Icon name="chat" size={20} color={Colors.textSecondary} />
                    <Text style={styles.iconActionLabel}>채팅</Text>
                  </TouchableOpacity>
                  {isLeaderOrStaff && (
                    <TouchableOpacity
                      style={styles.iconAction}
                      onPress={() => router.push(`/club/${clubId}/qr`)}
                      activeOpacity={0.7}
                      accessibilityLabel="모임 참여 QR"
                    >
                      <Icon name="qr" size={20} color={Colors.textSecondary} />
                      <Text style={styles.iconActionLabel}>QR</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <View style={styles.inviteRow}>
                <Text style={styles.inviteLabel}>초대코드</Text>
                <Text style={styles.inviteCode}>{club.inviteCode}</Text>
              </View>
            </View>
          )}

          {/* ═══ 정모 HERO — 화면의 주인공 ═══
              진행 중이면 dated hero 카드 + ONE primary action
                (운영진 → 운영판 들어가기 / 멤버 → 현황 보기).
              없으면 운영진 → "오늘 정모 시작" CTA, 멤버 → calm empty. */}
          {activeSession ? (
            <View style={styles.heroCard}>
              {/* 헤더: 오늘 정모 · M/D + 진행 중 배지 */}
              <View style={styles.heroHeader}>
                <View style={styles.heroDot} />
                <Text style={styles.heroTitle}>
                  오늘 정모 · {fmtShortDate(activeSession.startedAt)}
                </Text>
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>진행 중</Text>
                </View>
              </View>
              {/* 장소 · 코트 */}
              <Text style={styles.heroMeta}>
                {activeSession.facilityName} · 코트 {activeSession.courtIds?.length || 0}개
              </Text>

              {/* 멤버: 참석 상태 (체크인 / 참석 중 + 체크아웃) — quiet, 카드 안에서. */}
              {!isLeaderOrStaff && (
                !isCheckedIn ? (
                  <TouchableOpacity
                    style={styles.heroSecondaryBtn}
                    onPress={() => router.push(`/checkin-modal?clubSessionId=${activeSession.id}`)}
                    activeOpacity={0.85}
                    accessibilityLabel="체크인"
                  >
                    <Text style={styles.heroSecondaryText}>체크인</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.attendingRow}>
                    <View style={styles.attendingBadge}>
                      <Text style={styles.attendingText}>✓ 참석 중</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.heroCheckoutBtn, checkingOut && { opacity: 0.6 }]}
                      onPress={handleCheckOut}
                      disabled={checkingOut}
                      activeOpacity={0.85}
                      accessibilityLabel="체크아웃"
                    >
                      <Text style={styles.heroCheckoutText}>
                        {checkingOut ? '처리 중...' : '체크아웃'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )
              )}
              {!!autoCheckMsg && !isLeaderOrStaff && !isCheckedIn && (
                <Text style={styles.autoCheckHint}>📍 {autoCheckMsg}</Text>
              )}

              {/* ONE PRIMARY ACTION — 운영진: 운영판 들어가기 / 멤버: 현황 보기 */}
              {isLeaderOrStaff ? (
                <TouchableOpacity
                  style={styles.heroPrimaryBtn}
                  onPress={() => router.push(`/session/${activeSession.id}/operate`)}
                  activeOpacity={0.85}
                  accessibilityLabel="운영판 들어가기"
                >
                  <Text style={styles.heroPrimaryText}>운영판 들어가기</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.heroPrimaryBtn}
                  onPress={() => router.push(`/session/${activeSession.id}/board`)}
                  activeOpacity={0.85}
                  accessibilityLabel="현황 보기"
                >
                  <Text style={styles.heroPrimaryText}>현황 보기</Text>
                </TouchableOpacity>
              )}

              {/* 턴 관리 — 운영진 전용 quiet 보조 액션 (운영판 아래 작은 텍스트 링크). */}
              {isLeaderOrStaff && (
                <TouchableOpacity
                  style={styles.heroTextLink}
                  onPress={() => router.push(`/club/${clubId}/session`)}
                  activeOpacity={0.7}
                  accessibilityLabel="턴 관리"
                >
                  <Text style={styles.heroTextLinkText}>턴 관리</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            isLeaderOrStaff ? (
              <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                  <Text style={styles.heroTitleQuiet}>진행 중인 정모가 없어요</Text>
                </View>
                <Text style={styles.heroMeta}>
                  {startFacilityName ? `${startFacilityName}에서 ` : ''}바로 시작하고 출석을 받으세요 (체크인 불필요)
                </Text>
                <TouchableOpacity
                  style={[styles.heroPrimaryBtn, isStarting && { opacity: 0.6 }]}
                  onPress={handleQuickStartSession}
                  disabled={isStarting}
                  activeOpacity={0.85}
                  accessibilityLabel="오늘 정모 시작"
                >
                  <Text style={styles.heroPrimaryText}>
                    {isStarting ? '시작 중...' : '▶  오늘 정모 시작'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.heroTextLink}
                  onPress={handleOpenStartModal}
                  disabled={isStarting}
                >
                  <Text style={styles.heroTextLinkText}>시설·코트 선택해서 시작</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.heroCard, styles.heroCardEmpty]}>
                <Text style={styles.heroEmptyText}>진행 중인 정모가 없어요</Text>
                <Text style={styles.heroEmptySub}>정모가 시작되면 여기에서 바로 확인할 수 있어요</Text>
              </View>
            )
          )}

          {/* ─── 지난 정모 (정모 이력) ───
              이 모임의 종료된 정모들을 날짜별로. 탭하면 그 정모의 요약(읽기 전용)으로.
              진행 중 정모는 위 배너에서 이미 보여주므로 여기선 제외(ENDED만). */}
          {(() => {
            const past = sessions.filter((s) => s.status !== 'ACTIVE');
            const visible = showAllPast ? past : past.slice(0, 10);
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>지난 정모</Text>
                {past.length === 0 ? (
                  <View style={styles.pastEmpty}>
                    <Text style={styles.pastEmptyText}>아직 지난 정모가 없어요</Text>
                  </View>
                ) : (
                  <>
                    {visible.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={styles.pastRow}
                        onPress={() => router.push(`/session/${s.id}/summary`)}
                        activeOpacity={0.7}
                        accessibilityLabel={`${fmtKoreanDate(s.startedAt)} 정모 요약 보기`}
                      >
                        <View style={styles.pastRowLeft}>
                          <Text style={styles.pastDate}>{fmtKoreanDate(s.startedAt)}</Text>
                          <Text style={styles.pastMeta}>
                            출석 {s.attendanceCount}명 · 게임 {s.gameCount}개
                          </Text>
                        </View>
                        <View style={styles.pastEndedBadge}>
                          <Text style={styles.pastEndedText}>종료</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {!showAllPast && past.length > visible.length && (
                      <TouchableOpacity
                        style={styles.pastMoreBtn}
                        onPress={() => setShowAllPast(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.pastMoreText}>
                          더보기 ({past.length - visible.length})
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            );
          })()}

          {/* ═══ 출석왕 — TOP 3로 접고, 전체 보기로 펼침 (내 순위 pill은 항상) ═══ */}
          {clubId && <AttendanceLeaderboard clubId={clubId} maxRows={3} />}

          {/* ═══ 멤버 — secondary. "멤버 N명" 접이식 섹션 뒤로. ═══
              열면 체크인됨/오프라인으로 그룹. 진행 중 정모면 운영진은 출석 토글 가능. */}
          <View style={styles.membersSection}>
            <TouchableOpacity
              style={styles.membersHeader}
              onPress={() => setShowMembers((v) => !v)}
              activeOpacity={0.7}
              accessibilityLabel="멤버 목록 열기/닫기"
            >
              <Text style={styles.membersHeaderText}>멤버 {currentMembers.length}명</Text>
              <Icon
                name={showMembers ? 'chevronUp' : 'chevronDown'}
                size={18}
                color={Colors.textLight}
              />
            </TouchableOpacity>

            {showMembers && (
              <View style={styles.membersBody}>
                {checkedInMembers.length > 0 && (
                  <>
                    <Text style={styles.membersGroupLabel}>
                      체크인됨 ({checkedInMembers.length})
                    </Text>
                    {checkedInMembers.map((m) => (
                      <View key={m.userId}>{renderMember({ item: m })}</View>
                    ))}
                  </>
                )}
                <Text style={styles.membersGroupLabel}>
                  {checkedInMembers.length > 0 ? '오프라인' : '전체 멤버'} ({notCheckedInMembers.length})
                </Text>
                {notCheckedInMembers.map((m) => (
                  <View key={m.userId}>{renderMember({ item: m })}</View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Start Session Modal */}
        <Modal visible={showStartModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>정모 시작</Text>
                <TouchableOpacity onPress={() => setShowStartModal(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalDesc}>
                {startFacilityName || '시설'}에서 정모를 시작합니다 (체크인 불필요)
              </Text>

              {/* 시설 선택 — 여러 곳이 있을 때만. 체크인 없이도 고를 수 있다. */}
              {facilities.length > 1 && (
                <>
                  <Text style={styles.modalSubtitle}>시설</Text>
                  <View style={styles.facilityPickRow}>
                    {facilities.map((f) => {
                      const active = (selectedFacilityId || startFacilityId) === f.id;
                      return (
                        <TouchableOpacity
                          key={f.id}
                          style={[styles.facilityChip, active && styles.facilityChipActive]}
                          onPress={() => setSelectedFacilityId(f.id)}
                        >
                          <Text style={[styles.facilityChipText, active && styles.facilityChipTextActive]}>
                            {f.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* 코트 수 — 이 정모 전용 코트 1..N을 만든다 (다른 모임과 독립). */}
              <Text style={styles.modalSubtitle}>코트 수</Text>
              <View style={styles.courtCountRow}>
                <TouchableOpacity
                  style={styles.courtCountBtn}
                  onPress={() => setCourtCountInput((v) => String(Math.max(1, (parseInt(v, 10) || 1) - 1)))}
                  accessibilityLabel="코트 수 줄이기"
                >
                  <Text style={styles.courtCountBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.courtCountInput}
                  value={courtCountInput}
                  onChangeText={(t) => setCourtCountInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="코트 수"
                />
                <TouchableOpacity
                  style={styles.courtCountBtn}
                  onPress={() => setCourtCountInput((v) => String(Math.min(30, (parseInt(v, 10) || 0) + 1)))}
                  accessibilityLabel="코트 수 늘리기"
                >
                  <Text style={styles.courtCountBtnText}>＋</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.courtCountHint}>
                이 정모 전용 코트(코트 1~{Math.max(1, parseInt(courtCountInput, 10) || 1)})가 만들어져요. 운영 중에 추가/삭제할 수 있어요.
              </Text>

              <TouchableOpacity
                style={[styles.confirmBtn, isStarting && { opacity: 0.5 }]}
                onPress={() => handleStartSession(Math.max(1, parseInt(courtCountInput, 10) || 4))}
                disabled={isStarting}
              >
                <Text style={styles.confirmBtnText}>
                  {isStarting ? '시작 중...' : '정모 시작'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Role change modal */}
        <Modal visible={showRoleModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.roleModalContent}>
              <Text style={styles.roleModalTitle}>
                {selectedMember?.name} 역할 변경
              </Text>
              <Text style={styles.roleModalSub}>
                현재: {roleLabels[selectedMember?.role || ''] || selectedMember?.role}
              </Text>

              {['LEADER', 'STAFF', 'MEMBER'].map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.roleOption,
                    selectedMember?.role === role && styles.roleOptionActive,
                  ]}
                  onPress={() => handleChangeRole(role)}
                  disabled={selectedMember?.role === role}
                >
                  <Text style={[
                    styles.roleOptionText,
                    selectedMember?.role === role && styles.roleOptionTextActive,
                  ]}>
                    {roleLabels[role]}
                  </Text>
                  <Text style={styles.roleOptionDesc}>
                    {role === 'LEADER' ? '모임 전체 관리 권한'
                      : role === 'STAFF' ? '모임 운영 및 순번 관리 권한'
                      : '일반 회원'}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.roleCancel}
                onPress={() => { setShowRoleModal(false); setSelectedMember(null); }}
              >
                <Text style={styles.roleCancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  headerBack: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: Platform.OS === 'web' ? 8 : 0,
  },
  // ─── 모임 정체성 카드 (quiet, compact) ───
  infoCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    marginBottom: 0,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  infoTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  clubAvatarLarge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubAvatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
  },
  clubName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
  },
  clubMeta: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  // 작은 아이콘 액션 (채팅 / QR) — full-width 버튼 stack 제거
  headerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconAction: {
    width: 48,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
  },
  iconActionLabel: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
  },
  // 초대코드 (작게, 카드 하단)
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  inviteLabel: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '600',
  },
  inviteCode: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 1.5,
  },
  // ═══ 정모 HERO 카드 (화면의 주인공) ═══
  heroCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
    padding: 18,
    gap: 14,
    ...createShadow(2, 10, 0.06, 3),
  },
  heroCardEmpty: {
    borderColor: Colors.border,
    alignItems: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.info,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
    flexShrink: 1,
  },
  heroTitleQuiet: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  heroMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: -6,
  },
  // 진행 중 배지 (정모 카드 제목 옆) — calm info violet
  liveBadge: {
    backgroundColor: Colors.infoBg,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  liveBadgeText: {
    color: Colors.info,
    fontSize: 10.5,
    fontWeight: '800',
  },
  // ONE primary action — teal (앱의 primary, 화면에서 유일한 강조)
  heroPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    ...createShadow(2, 8, 0.18, 3, Colors.primary),
  },
  heroPrimaryText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
  },
  // 멤버 체크인 (secondary, 카드 안 — outline)
  heroSecondaryBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  heroSecondaryText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  heroCheckoutBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  heroCheckoutText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  heroTextLink: {
    alignSelf: 'center',
    paddingVertical: 2,
  },
  heroTextLinkText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  heroEmptyText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  heroEmptySub: {
    fontSize: 12.5,
    color: Colors.textLight,
    textAlign: 'center',
  },
  autoCheckHint: {
    marginTop: -4,
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 12.5,
  },
  // 참석 중 표시 + 체크아웃 (한 줄)
  attendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attendingBadge: {
    flex: 1,
    backgroundColor: Colors.secondaryBg,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.secondary,
  },
  attendingText: {
    color: Colors.secondary,
    fontSize: 15,
    fontWeight: '800',
  },
  // Section
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  // 지난 정모 행 (날짜 + 출석/게임 수 + 종료 배지)
  pastRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pastRowLeft: {
    flex: 1,
  },
  pastDate: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  pastMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  pastEndedBadge: {
    backgroundColor: Colors.divider,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  pastEndedText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textLight,
  },
  pastEmpty: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
  },
  pastEmptyText: {
    fontSize: 13,
    color: Colors.textLight,
  },
  pastMoreBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  pastMoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  // Member card
  memberCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarActive: {
    backgroundColor: Colors.primaryLight,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textLight,
  },
  avatarTextActive: {
    color: Colors.primary,
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  meBadge: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
  },
  memberMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  offlineText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  editHint: {
    fontSize: 18,
    color: Colors.textLight,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  // Modal base
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  modalClose: {
    fontSize: 22,
    color: Colors.textLight,
    padding: 4,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  modalSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },
  // 시설 선택 칩 (여러 시설일 때)
  facilityPickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  facilityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  facilityChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '14',
  },
  facilityChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  facilityChipTextActive: {
    color: Colors.primary,
  },
  // 코트 수 입력 (스테퍼)
  courtCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  courtCountBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDE9FE',
  },
  courtCountBtnText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#7C3AED',
  },
  courtCountInput: {
    minWidth: 72,
    height: 56,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  courtCountHint: {
    fontSize: 12,
    color: Colors.textLight,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  // Role modal
  roleModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 32,
    marginBottom: 'auto',
    marginTop: 'auto',
  },
  roleModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  roleModalSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  roleOption: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  roleOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  roleOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  roleOptionTextActive: {
    color: Colors.primary,
  },
  roleOptionDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  roleCancel: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
  },
  roleCancelText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  // ═══ 멤버 — 접이식 섹션 (secondary) ═══
  membersSection: {
    marginTop: 20,
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  membersHeaderText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
  },
  membersBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  membersGroupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
});

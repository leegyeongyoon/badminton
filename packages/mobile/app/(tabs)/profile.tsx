import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { profileApi } from '../../services/profile';
import { Colors } from '../../constants/colors';
import { createShadow } from '../../constants/theme';
import { showAlert, showConfirm } from '../../utils/alert';
import { showError } from '../../utils/feedback';
import { startKakaoWebLogin } from '../../services/kakao';
import { startGoogleWebLogin } from '../../services/google';
import { SKILL_LEVELS as SKILL_LETTERS, getSkillMeta } from '../../constants/skill';
import { GENDER_META, type Gender } from '../../constants/gender';
import { GenderMarker } from '../../components/ui/GenderMarker';

// 계정 연동(account linking) providers rendered in the 내 정보 section.
const LINK_PROVIDERS = [
  { key: 'kakao' as const, label: '카카오', start: startKakaoWebLogin },
  { key: 'google' as const, label: '구글', start: startGoogleWebLogin },
];

const roleLabels: Record<string, string> = {
  FACILITY_ADMIN: '시설 관리자',
  CLUB_LEADER: '모임 대표',
  PLAYER: '일반 회원',
};

const GAME_TYPES = [
  { key: 'SINGLES', label: '단식' },
  { key: 'DOUBLES', label: '복식' },
  { key: 'MIXED_DOUBLES', label: '혼합복식' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user, loadUser, unlinkKakao, unlinkGoogle } = useAuthStore();

  const [skillLevel, setSkillLevel] = useState<string>('');
  const [gender, setGender] = useState<string>('');
  const [preferredGameTypes, setPreferredGameTypes] = useState<string[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [penalties, setPenalties] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadProfileData = async () => {
    setIsLoading(true);
    try {
      const [profileRes, statsRes, penaltiesRes] = await Promise.all([
        profileApi.getProfile(),
        profileApi.getStats(),
        profileApi.getPenalties(),
      ]);
      setSkillLevel(profileRes.data.skillLevel || '');
      setGender(profileRes.data.gender || '');
      setPreferredGameTypes(profileRes.data.preferredGameTypes || []);
      setStats(statsRes.data);
      setPenalties(penaltiesRes.data || []);
    } catch {
      showAlert('오류', '프로필 정보를 불러오지 못했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfileData();
  }, []);

  const handleSkillLevelChange = async (level: string) => {
    setSkillLevel(level);
    setIsSaving(true);
    try {
      await profileApi.updateProfile({ skillLevel: level });
    } catch {
      showAlert('오류', '설정 저장에 실패했습니다');
    } finally {
      setIsSaving(false);
    }
  };

  // 성별 (남/여) — 필수 항목. 카카오는 성별을 주지 않으므로 여기서 변경 가능하게 하고,
  // 변경 시 즉시 반영 + 인증 사용자 갱신(loadUser)으로 게이트가 새 값을 보게 한다.
  const handleGenderChange = async (next: Gender) => {
    const prev = gender;
    if (prev === next) return;
    setGender(next);
    setIsSaving(true);
    try {
      await profileApi.updateProfile({ gender: next });
      // Refresh the auth user so the onboarding gate sees the new gender and
      // won't bounce a previously gender-less member back to profile-setup.
      await loadUser();
    } catch {
      setGender(prev);
      showAlert('오류', '설정 저장에 실패했습니다');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGameTypeToggle = async (gameType: string) => {
    let updated: string[];
    if (preferredGameTypes.includes(gameType)) {
      updated = preferredGameTypes.filter((t) => t !== gameType);
    } else {
      updated = [...preferredGameTypes, gameType];
    }
    setPreferredGameTypes(updated);
    setIsSaving(true);
    try {
      await profileApi.updateProfile({ preferredGameTypes: updated });
    } catch {
      showAlert('오류', '설정 저장에 실패했습니다');
    } finally {
      setIsSaving(false);
    }
  };

  // ── 계정 연동(account linking) ──────────────────────────────────────────
  // Count the user's login methods (password + each linked provider) so the
  // "keep ≥1 method" rule hides the last 연동 해제 (the server enforces it too).
  const linkedProviders = user?.linkedProviders ?? { kakao: false, google: false };
  const hasPassword = !!user?.hasPassword;
  const methodCount =
    (hasPassword ? 1 : 0) + (linkedProviders.kakao ? 1 : 0) + (linkedProviders.google ? 1 : 0);

  // Start the link-mode OAuth round-trip. WEB full-page redirect → the provider
  // returns to our origin and the callback (useKakao/GoogleWebCallback) finishes
  // the link under the persisted token. `start('link')` returns false when the
  // provider key isn't configured (placeholder) → friendly notice.
  const handleLink = (start: (mode?: 'login' | 'link') => boolean, label: string) => {
    const started = start('link');
    if (!started) {
      showError(`${label} 연동 설정이 준비 중이에요 (키 필요)`);
    }
    // started === true → the page is navigating to the provider; nothing else to do.
  };

  const handleUnlink = (key: 'kakao' | 'google', label: string) => {
    showConfirm(
      `${label} 연동 해제`,
      `${label} 계정 연동을 해제할까요?`,
      async () => {
        try {
          if (key === 'kakao') await unlinkKakao();
          else await unlinkGoogle();
        } catch (err: any) {
          // 400 (마지막 로그인 수단…) etc. → surface the server message.
          showError(err?.response?.data?.error || err?.message || '연동 해제에 실패했어요');
        }
      },
      '연동 해제',
      '취소',
      'danger',
    );
  };

  const formatRemainingTime = (expiresAt: string): string => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return '만료됨';
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
    return `${minutes}분 남음`;
  };

  const activePenalty = penalties.find(
    (p: any) => p.status === 'ACTIVE' && new Date(p.expiresAt).getTime() > Date.now(),
  );

  const currentSkill = skillLevel ? getSkillMeta(skillLevel) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        Platform.OS === 'web' ? undefined : (
          <RefreshControl refreshing={isLoading} onRefresh={loadProfileData} />
        )
      }
    >
      {/* Profile card with skill badge */}
      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.[0] || '?'}</Text>
          </View>
          {currentSkill && (
            <View style={[styles.skillBadgeOverlay, { backgroundColor: currentSkill.color }]}>
              <Text style={styles.skillBadgeIcon}>{currentSkill.level}</Text>
            </View>
          )}
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.phone}>{user?.phone}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {roleLabels[user?.role || ''] || user?.role}
            </Text>
          </View>
          {currentSkill && (
            <View style={[styles.skillLevelBadge, { backgroundColor: currentSkill.color + '20', borderColor: currentSkill.color }]}>
              <Text style={[styles.skillLevelText, { color: currentSkill.color }]}>
                {currentSkill.level} · {currentSkill.description}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Penalty banner */}
      {activePenalty && (
        <View style={styles.penaltyCard}>
          <View style={styles.penaltyHeader}>
            <Text style={styles.penaltyHeaderIcon}>⚠️</Text>
            <Text style={styles.penaltyHeaderTitle}>패널티 적용 중</Text>
          </View>
          <View style={styles.penaltyBody}>
            <Text style={styles.penaltyReason}>{activePenalty.reason || '노쇼'}</Text>
            <Text style={styles.penaltyTime}>
              {formatRemainingTime(activePenalty.expiresAt)}
            </Text>
          </View>
        </View>
      )}

      {/* Game stats dashboard */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>게임 통계</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.gamesPlayedToday ?? 0}</Text>
            <Text style={styles.statLabel}>오늘 게임</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.gamesPlayed ?? 0}</Text>
            <Text style={styles.statLabel}>총 게임</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, (stats?.noShowCount ?? 0) > 0 && styles.statValueDanger]}>
              {stats?.noShowCount ?? 0}
            </Text>
            <Text style={styles.statLabel}>노쇼</Text>
          </View>
        </View>
        {stats?.winRate !== undefined && (
          <View style={styles.winRateCard}>
            <Text style={styles.winRateLabel}>승률</Text>
            <View style={styles.winRateBarContainer}>
              <View style={styles.winRateBar}>
                <View style={[styles.winRateFill, { width: `${stats.winRate}%` }]} />
              </View>
              <Text style={styles.winRateValue}>{stats.winRate}%</Text>
            </View>
          </View>
        )}
      </View>

      {/* Player settings section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>플레이어 설정</Text>

        {/* Skill level */}
        <View style={styles.settingCard}>
          <Text style={styles.settingLabel}>실력 수준</Text>
          <View style={styles.skillButtonRow}>
            {SKILL_LETTERS.map((lv) => {
              const meta = getSkillMeta(lv);
              const active = skillLevel === lv;
              return (
                <TouchableOpacity
                  key={lv}
                  style={[
                    styles.skillButton,
                    active && { backgroundColor: meta.color, borderColor: meta.color },
                  ]}
                  onPress={() => handleSkillLevelChange(lv)}
                >
                  <Text style={[styles.skillIcon, active && styles.skillButtonTextActive]}>{lv}</Text>
                  <Text
                    style={[
                      styles.skillButtonText,
                      active && styles.skillButtonTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {meta.description}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Gender (성별) — 필수 */}
        <View style={styles.settingCard}>
          <Text style={styles.settingLabel}>성별</Text>
          <View style={styles.genderRow}>
            {(['M', 'F'] as Gender[]).map((g) => {
              const meta = GENDER_META[g];
              const active = gender === g;
              return (
                <TouchableOpacity
                  key={g}
                  style={[
                    styles.genderButton,
                    active && { backgroundColor: meta.bg, borderColor: meta.color },
                  ]}
                  onPress={() => handleGenderChange(g)}
                  accessibilityRole="button"
                  accessibilityLabel={`성별 ${meta.label}`}
                  accessibilityState={{ selected: active }}
                >
                  <GenderMarker meta={meta} size={18} color={active ? meta.color : Colors.textSecondary} />
                  <Text style={[styles.genderLabel, active && { color: meta.color, fontWeight: '700' }]}>
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Preferred game types */}
        <View style={styles.settingCard}>
          <Text style={styles.settingLabel}>선호 게임 유형</Text>
          <View style={styles.gameTypeRow}>
            {GAME_TYPES.map((gt) => {
              const isSelected = preferredGameTypes.includes(gt.key);
              return (
                <TouchableOpacity
                  key={gt.key}
                  style={[
                    styles.gameTypeToggle,
                    isSelected && styles.gameTypeToggleActive,
                  ]}
                  onPress={() => handleGameTypeToggle(gt.key)}
                >
                  <View
                    style={[
                      styles.toggleIndicator,
                      isSelected && styles.toggleIndicatorActive,
                    ]}
                  >
                    {isSelected && <Text style={styles.toggleCheck}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.gameTypeToggleText,
                      isSelected && styles.gameTypeToggleTextActive,
                    ]}
                  >
                    {gt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Account section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>계정</Text>
        <TouchableOpacity
          style={styles.settingCard}
          onPress={() => router.push('/change-password')}
          activeOpacity={0.7}
        >
          <View style={styles.settingRow}>
            <Text style={styles.settingRowLabel}>비밀번호 변경</Text>
            <Text style={styles.settingArrow}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 계정 연동 (account linking) — attach a 2nd social provider so EITHER
          provider logs into THIS one account. Phone accounts also list 비밀번호
          as a login method. The last remaining method can't be unlinked. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>계정 연동</Text>
        <View style={styles.settingCard}>
          {/* 비밀번호 (phone accounts only) — a login method, not unlinkable here. */}
          {hasPassword && (
            <View style={[styles.linkRow, styles.linkRowDivider]}>
              <View style={styles.linkLabelWrap}>
                <Text style={styles.linkLabel}>비밀번호</Text>
                <Text style={styles.linkSubLabel}>전화번호 로그인</Text>
              </View>
              <View style={styles.linkedBadge}>
                <Text style={styles.linkedBadgeText}>✓ 사용 중</Text>
              </View>
            </View>
          )}

          {LINK_PROVIDERS.map((p, idx) => {
            const linked = linkedProviders[p.key];
            // Show 연동 해제 only when linked AND another method remains (≥2 total).
            const canUnlink = linked && methodCount > 1;
            const isLast = idx === LINK_PROVIDERS.length - 1;
            return (
              <View
                key={p.key}
                style={[styles.linkRow, !isLast && styles.linkRowDivider]}
              >
                <View style={styles.linkLabelWrap}>
                  <Text style={styles.linkLabel}>{p.label}</Text>
                  <Text style={styles.linkSubLabel}>
                    {linked ? `${p.label} 로그인` : `${p.label} 계정 연결`}
                  </Text>
                </View>
                {linked ? (
                  <View style={styles.linkActionWrap}>
                    <View style={styles.linkedBadge}>
                      <Text style={styles.linkedBadgeText}>✓ 연동됨</Text>
                    </View>
                    {canUnlink && (
                      <TouchableOpacity
                        style={styles.unlinkButton}
                        onPress={() => handleUnlink(p.key, p.label)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.label} 연동 해제`}
                      >
                        <Text style={styles.unlinkButtonText}>연동 해제</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.linkButton}
                    onPress={() => handleLink(p.start, p.label)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.label} 연동`}
                  >
                    <Text style={styles.linkButtonText}>{p.label} 연동</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    ...createShadow(1, 4, 0.05, 2),
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.primary,
  },
  skillBadgeOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  skillBadgeIcon: {
    fontSize: 12,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  phone: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  skillLevelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  skillLevelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Penalty card
  penaltyCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  penaltyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
  },
  penaltyHeaderIcon: {
    fontSize: 18,
  },
  penaltyHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.danger,
  },
  penaltyBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  penaltyReason: {
    fontSize: 14,
    color: Colors.danger,
    fontWeight: '500',
  },
  penaltyTime: {
    fontSize: 14,
    color: Colors.danger,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    ...createShadow(1, 2, 0.03, 1),
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  statValueDanger: {
    color: Colors.danger,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  // Win rate
  winRateCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
  },
  winRateLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  winRateBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  winRateBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  winRateFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  winRateValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
    minWidth: 40,
    textAlign: 'right',
  },
  // Settings
  settingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingRowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  settingArrow: {
    fontSize: 22,
    color: Colors.textLight,
  },
  // 계정 연동 rows
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  linkRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  linkLabelWrap: {
    flex: 1,
    gap: 2,
  },
  linkLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  linkSubLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  linkActionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
  },
  linkedBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  linkButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  linkButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  unlinkButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  unlinkButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  skillButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillButton: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: 2,
  },
  skillIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textSecondary,
  },
  skillButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  skillButtonTextActive: {
    color: '#fff',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  genderLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  gameTypeRow: {
    gap: 10,
  },
  gameTypeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  gameTypeToggleActive: {},
  toggleIndicator: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  toggleIndicatorActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  toggleCheck: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  gameTypeToggleText: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  gameTypeToggleTextActive: {
    color: Colors.text,
    fontWeight: '600',
  },
});

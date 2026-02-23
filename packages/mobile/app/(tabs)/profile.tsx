import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { profileApi } from '../../services/profile';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

const roleLabels: Record<string, string> = {
  FACILITY_ADMIN: '시설 관리자',
  CLUB_LEADER: '모임 대표',
  PLAYER: '일반 회원',
};

const SKILL_LEVELS = [
  { key: 'BEGINNER', label: Strings.player.skillLevel.BEGINNER, color: Colors.skillBeginner, icon: '🔰' },
  { key: 'INTERMEDIATE', label: Strings.player.skillLevel.INTERMEDIATE, color: Colors.skillIntermediate, icon: '⭐' },
  { key: 'ADVANCED', label: Strings.player.skillLevel.ADVANCED, color: Colors.skillAdvanced, icon: '🏅' },
  { key: 'PRO', label: '프로', color: Colors.skillExpert, icon: '🏆' },
];

const GAME_TYPES = [
  { key: 'SINGLES', label: '단식' },
  { key: 'DOUBLES', label: '복식' },
  { key: 'MIXED_DOUBLES', label: '혼합복식' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [skillLevel, setSkillLevel] = useState<string>('');
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

  const currentSkill = SKILL_LEVELS.find((s) => s.key === skillLevel);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={loadProfileData} />
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
              <Text style={styles.skillBadgeIcon}>{currentSkill.icon}</Text>
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
                {currentSkill.icon} {currentSkill.label}
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
            {SKILL_LEVELS.map((level) => (
              <TouchableOpacity
                key={level.key}
                style={[
                  styles.skillButton,
                  skillLevel === level.key && { backgroundColor: level.color, borderColor: level.color },
                ]}
                onPress={() => handleSkillLevelChange(level.key)}
              >
                <Text style={styles.skillIcon}>{level.icon}</Text>
                <Text
                  style={[
                    styles.skillButtonText,
                    skillLevel === level.key && styles.skillButtonTextActive,
                  ]}
                >
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
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
  skillButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  skillButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: 2,
  },
  skillIcon: {
    fontSize: 16,
  },
  skillButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  skillButtonTextActive: {
    color: '#fff',
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

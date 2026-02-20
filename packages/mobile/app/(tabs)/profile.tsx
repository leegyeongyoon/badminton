import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { profileApi } from '../../services/profile';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

const roleLabels: Record<string, string> = {
  FACILITY_ADMIN: '시설 관리자',
  CLUB_LEADER: '모임 리더',
  PLAYER: '선수',
};

const SKILL_LEVELS = [
  { key: 'BEGINNER', label: '초급' },
  { key: 'INTERMEDIATE', label: '중급' },
  { key: 'ADVANCED', label: '상급' },
  { key: 'PRO', label: '프로' },
];

const GAME_TYPES = [
  { key: 'SINGLES', label: '단식' },
  { key: 'DOUBLES', label: '복식' },
  { key: 'MIXED_DOUBLES', label: '혼합복식' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { status } = useCheckinStore();

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
      // Silent fail on load
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

  const handleLogout = () => {
    Alert.alert(Strings.auth.logout, '정말 로그아웃 하시겠습니까?', [
      { text: Strings.common.cancel, style: 'cancel' },
      { text: Strings.auth.logout, style: 'destructive', onPress: logout },
    ]);
  };

  const handleOpenDisplay = () => {
    const facilityId = status?.facilityId;
    if (!facilityId) {
      showAlert('알림', '체크인 후 TV 디스플레이 모드를 사용할 수 있습니다');
      return;
    }
    router.push(`/display/${facilityId}`);
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={loadProfileData} />
      }
    >
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.[0] || '?'}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.phone}>{user?.phone}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>
            {roleLabels[user?.role || ''] || user?.role}
          </Text>
        </View>
      </View>

      {status && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>현재 체크인</Text>
          <Text style={styles.infoValue}>{status.facilityName}</Text>
        </View>
      )}

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
                  skillLevel === level.key && styles.skillButtonActive,
                ]}
                onPress={() => handleSkillLevelChange(level.key)}
              >
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

      {/* Game stats section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>게임 통계</Text>
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats?.gamesPlayed ?? 0}</Text>
              <Text style={styles.statLabel}>총 게임 수</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, (stats?.noShowCount ?? 0) > 0 && styles.statValueDanger]}>
                {stats?.noShowCount ?? 0}
              </Text>
              <Text style={styles.statLabel}>노쇼 횟수</Text>
            </View>
          </View>
          {activePenalty && (
            <View style={styles.penaltyBanner}>
              <Text style={styles.penaltyIcon}>⚠️</Text>
              <View style={styles.penaltyInfo}>
                <Text style={styles.penaltyTitle}>패널티 적용 중</Text>
                <Text style={styles.penaltyTime}>
                  {formatRemainingTime(activePenalty.expiresAt)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* TV Display mode button */}
      <TouchableOpacity style={styles.displayButton} onPress={handleOpenDisplay}>
        <Text style={styles.displayIcon}>📺</Text>
        <View style={styles.displayInfo}>
          <Text style={styles.displayText}>TV 디스플레이 모드</Text>
          <Text style={styles.displayDesc}>대형 화면에 코트 현황을 표시합니다</Text>
        </View>
        <Text style={styles.displayArrow}>›</Text>
      </TouchableOpacity>

      {/* Logout button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{Strings.auth.logout}</Text>
      </TouchableOpacity>
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
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.primary,
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
    marginBottom: 8,
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
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
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
  },
  skillButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  skillButtonText: {
    fontSize: 13,
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
  statsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  statsRow: {
    flexDirection: 'row',
    padding: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.divider,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  statValueDanger: {
    color: Colors.danger,
  },
  statLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  penaltyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#FECACA',
  },
  penaltyIcon: {
    fontSize: 20,
  },
  penaltyInfo: {
    flex: 1,
  },
  penaltyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.danger,
  },
  penaltyTime: {
    fontSize: 13,
    color: Colors.danger,
    marginTop: 2,
  },
  displayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  displayIcon: {
    fontSize: 24,
  },
  displayInfo: {
    flex: 1,
  },
  displayText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  displayDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  displayArrow: {
    fontSize: 24,
    color: Colors.textLight,
  },
  logoutButton: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  logoutText: {
    color: Colors.danger,
    fontSize: 16,
    fontWeight: '600',
  },
});

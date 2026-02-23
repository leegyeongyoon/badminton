import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Share,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useFacilityStore } from '../../store/facilityStore';
import { useClubStore } from '../../store/clubStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import api from '../../services/api';
import { checkinApi } from '../../services/checkin';
import { profileApi } from '../../services/profile';

const SKILL_LEVELS: Record<string, { label: string; color: string; icon: string }> = {
  BEGINNER: { label: Strings.player.skillLevel.BEGINNER, color: Colors.skillBeginner, icon: '🔰' },
  INTERMEDIATE: { label: Strings.player.skillLevel.INTERMEDIATE, color: Colors.skillIntermediate, icon: '⭐' },
  ADVANCED: { label: Strings.player.skillLevel.ADVANCED, color: Colors.skillAdvanced, icon: '🏅' },
  PRO: { label: '프로', color: Colors.skillExpert, icon: '🏆' },
};

const GAME_TYPE_LABELS: Record<string, string> = {
  SINGLES: '단식',
  DOUBLES: '복식',
  MIXED_DOUBLES: '혼합복식',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const { user, logout } = useAuthStore();
  const { selectedFacility, clearSelectedFacility } = useFacilityStore();
  const { clubs, fetchClubs, createClub, joinClub } = useClubStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const facilityId = checkinStatus?.facilityId;

  useEffect(() => {
    loadUnreadCount();
    checkAdminStatus();
    fetchClubs();
    loadProfile();
  }, [facilityId]);

  const loadProfile = async () => {
    try {
      const { data } = await profileApi.getProfile();
      setProfileData(data);
    } catch { /* silent */ }
  };

  const handleCheckout = () => {
    showConfirm('체크아웃', '체크아웃 하시겠습니까?', async () => {
      try {
        await checkinApi.checkOut();
        await fetchStatus();
        showAlert('완료', '체크아웃 되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '체크아웃에 실패했습니다');
      }
    });
  };

  const loadUnreadCount = async () => {
    try {
      const { data } = await api.get('/notifications', { params: { unreadOnly: true } });
      setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0);
    } catch { /* silent */ }
  };

  const checkAdminStatus = async () => {
    if (!user) return;
    if (user.role === 'FACILITY_ADMIN') { setIsAdmin(true); return; }
    if (facilityId) {
      try {
        const { data } = await api.get('/users/me/admin-facilities');
        setIsAdmin(Array.isArray(data) && data.some((f: any) => f.id === facilityId));
      } catch { setIsAdmin(user.role === 'FACILITY_ADMIN'); }
    }
  };

  const handleChangeFacility = async () => {
    await clearSelectedFacility();
  };

  const handleLogout = () => {
    showConfirm(Strings.auth.logout, '로그아웃하시겠습니까?', async () => {
      await logout();
    }, Strings.auth.logout);
  };

  const handleCreateClub = async () => {
    if (!clubName.trim()) return;
    try {
      await createClub(clubName.trim());
      setClubName('');
      setShowCreateModal(false);
      fetchClubs();
    } catch (err: any) {
      showAlert(Strings.common.error, err.response?.data?.error || '모임 생성에 실패했습니다');
    }
  };

  const handleJoinClub = async () => {
    if (!inviteCode.trim()) return;
    try {
      await joinClub(inviteCode.trim());
      setInviteCode('');
      setShowJoinModal(false);
      fetchClubs();
    } catch (err: any) {
      showAlert(Strings.common.error, err.response?.data?.error || '모임 가입에 실패했습니다');
    }
  };

  const handleShareInvite = async (code: string, name: string) => {
    try {
      await Share.share({ message: `${Strings.app.name} - ${name} 모임에 참여하세요! 초대코드: ${code}` });
    } catch { /* silent */ }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User card */}
      <View style={styles.userCard}>
        <View style={styles.userCardTop}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{user?.name?.[0] || '?'}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userPhone}>{user?.phone}</Text>
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Text style={styles.profileButtonText}>{Strings.settings.profileEdit} ›</Text>
          </TouchableOpacity>
        </View>
        {profileData && (profileData.skillLevel || (profileData.preferredGameTypes?.length > 0)) && (
          <View style={styles.profileSummary}>
            {profileData.skillLevel && SKILL_LEVELS[profileData.skillLevel] && (
              <View style={[styles.skillBadge, { backgroundColor: SKILL_LEVELS[profileData.skillLevel].color + '20', borderColor: SKILL_LEVELS[profileData.skillLevel].color }]}>
                <Text style={[styles.skillBadgeText, { color: SKILL_LEVELS[profileData.skillLevel].color }]}>
                  {SKILL_LEVELS[profileData.skillLevel].icon} {SKILL_LEVELS[profileData.skillLevel].label}
                </Text>
              </View>
            )}
            {profileData.preferredGameTypes?.map((gt: string) => (
              <View key={gt} style={styles.gameTypeChip}>
                <Text style={styles.gameTypeChipText}>{GAME_TYPE_LABELS[gt] || gt}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Facility section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{Strings.settings.facility}</Text>
        <View style={styles.menuGroup}>
          <TouchableOpacity style={styles.menuItem} onPress={handleChangeFacility}>
            <Text style={styles.menuIcon}>🏟️</Text>
            <View style={styles.menuInfo}>
              <Text style={styles.menuLabel}>{Strings.facility.change}</Text>
              <Text style={styles.menuDesc}>
                {selectedFacility?.name || Strings.facility.changeDescription}
              </Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
          {checkinStatus && (
            <View style={[styles.menuItem, styles.menuItemBorder]}>
              <Text style={styles.menuIcon}>📷</Text>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>{Strings.settings.checkinStatus}</Text>
                <Text style={styles.menuDesc}>{checkinStatus.facilityName}에 체크인 중</Text>
              </View>
              <View style={styles.checkinActions}>
                <View style={styles.checkinBadge}>
                  <Text style={styles.checkinBadgeText}>{Strings.checkin.checkedIn}</Text>
                </View>
                <TouchableOpacity style={styles.checkoutButton} onPress={handleCheckout}>
                  <Text style={styles.checkoutButtonText}>체크아웃</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Clubs section (absorbed from clubs.tsx) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{Strings.settings.clubs}</Text>
          <View style={styles.clubActions}>
            <TouchableOpacity style={styles.clubActionBtn} onPress={() => setShowCreateModal(true)}>
              <Text style={styles.clubActionBtnText}>+ {Strings.club.create}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clubActionBtn, styles.clubActionBtnOutline]}
              onPress={() => setShowJoinModal(true)}
            >
              <Text style={[styles.clubActionBtnText, { color: Colors.primary }]}>{Strings.club.join}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.menuGroup}>
          {clubs.length === 0 ? (
            <View style={styles.emptyClubs}>
              <Text style={styles.emptyClubsText}>{Strings.club.noClubs}</Text>
            </View>
          ) : (
            clubs.map((club: any, idx: number) => (
              <TouchableOpacity
                key={club.id}
                style={[styles.clubItem, idx > 0 && styles.menuItemBorder]}
                onPress={() => router.push(`/club/${club.id}`)}
              >
                <View style={styles.clubAvatar}>
                  <Text style={styles.clubAvatarText}>{club.name[0]}</Text>
                </View>
                <View style={styles.clubInfo}>
                  <Text style={styles.clubName}>{club.name}</Text>
                  <View style={styles.clubMeta}>
                    <Text style={styles.clubMetaText}>{Strings.club.members} {club.memberCount}명</Text>
                    {club.isLeader && (
                      <View style={styles.leaderBadge}>
                        <Text style={styles.leaderBadgeText}>대표</Text>
                      </View>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={(e) => { e.stopPropagation(); handleShareInvite(club.inviteCode, club.name); }}
                >
                  <Text style={styles.shareIcon}>📤</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </View>
      </View>

      {/* Navigation items */}
      <View style={styles.section}>
        <View style={styles.menuGroup}>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/notifications')}>
            <Text style={styles.menuIcon}>🔔</Text>
            <View style={styles.menuInfo}>
              <Text style={styles.menuLabel}>{Strings.settings.notifications}</Text>
            </View>
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount}</Text>
              </View>
            )}
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemBorder]}
              onPress={() => router.push('/admin')}
            >
              <Text style={styles.menuIcon}>⚙️</Text>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>{Strings.settings.admin}</Text>
                <Text style={styles.menuDesc}>{Strings.settings.adminDesc}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          )}

          {facilityId && (
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemBorder]}
              onPress={() => router.push(`/display/${facilityId}`)}
            >
              <Text style={styles.menuIcon}>📺</Text>
              <View style={styles.menuInfo}>
                <Text style={styles.menuLabel}>{Strings.settings.tvDisplay}</Text>
                <Text style={styles.menuDesc}>{Strings.settings.tvDisplayDesc}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{Strings.auth.logout}</Text>
      </TouchableOpacity>

      <View style={styles.appInfo}>
        <Text style={styles.appInfoText}>{Strings.app.name}</Text>
        <Text style={styles.versionText}>v1.0.0</Text>
      </View>

      {/* Create Club Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{Strings.club.create}</Text>
            <Text style={styles.modalDesc}>모임 이름을 입력하세요</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="모임 이름"
              placeholderTextColor={Colors.textLight}
              value={clubName}
              onChangeText={setClubName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setShowCreateModal(false); setClubName(''); }}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !clubName.trim() && { opacity: 0.5 }]}
                onPress={handleCreateClub}
                disabled={!clubName.trim()}
              >
                <Text style={styles.confirmText}>{Strings.common.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join Club Modal */}
      <Modal visible={showJoinModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{Strings.club.join}</Text>
            <Text style={styles.modalDesc}>리더에게 받은 초대코드 8자리를 입력하세요</Text>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              placeholder="ABCD1234"
              placeholderTextColor={Colors.textLight}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              maxLength={8}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setShowJoinModal(false); setInviteCode(''); }}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !inviteCode.trim() && { opacity: 0.5 }]}
                onPress={handleJoinClub}
                disabled={!inviteCode.trim()}
              >
                <Text style={styles.confirmText}>{Strings.common.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },

  // User card
  userCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  userCardTop: {
    flexDirection: 'row', alignItems: 'center',
  },
  userAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  userAvatarText: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  userInfo: { flex: 1 },
  userName: { fontSize: 17, fontWeight: '700', color: Colors.text },
  userPhone: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  profileButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primaryLight },
  profileButtonText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  profileSummary: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  skillBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1,
  },
  skillBadgeText: { fontSize: 12, fontWeight: '600' },
  gameTypeChip: {
    backgroundColor: Colors.background, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
  },
  gameTypeChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },

  // Sections
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, paddingLeft: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

  // Menu group
  menuGroup: {
    backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  menuItemBorder: { borderTopWidth: 1, borderTopColor: Colors.divider },
  menuIcon: { fontSize: 24 },
  menuInfo: { flex: 1 },
  menuLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  menuDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  menuArrow: { fontSize: 22, color: Colors.textLight, marginLeft: 4 },
  checkinActions: { alignItems: 'flex-end', gap: 6 },
  checkinBadge: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  checkinBadgeText: { fontSize: 11, color: Colors.secondary, fontWeight: '600' },
  checkoutButton: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.danger,
  },
  checkoutButtonText: { fontSize: 11, color: Colors.danger, fontWeight: '600' },
  notifBadge: {
    backgroundColor: Colors.danger, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, minWidth: 22, alignItems: 'center',
  },
  notifBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  // Clubs
  clubActions: { flexDirection: 'row', gap: 8 },
  clubActionBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  clubActionBtnOutline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary },
  clubActionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  emptyClubs: { padding: 24, alignItems: 'center' },
  emptyClubsText: { fontSize: 14, color: Colors.textSecondary },
  clubItem: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  clubAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  clubAvatarText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  clubInfo: { flex: 1 },
  clubName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  clubMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  clubMetaText: { fontSize: 12, color: Colors.textSecondary },
  leaderBadge: { backgroundColor: Colors.warning + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  leaderBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.warning },
  shareBtn: { padding: 8 },
  shareIcon: { fontSize: 16 },

  // Logout
  logoutButton: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, alignItems: 'center',
    marginBottom: 16, borderWidth: 1, borderColor: Colors.dangerLight,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.danger },

  // App info
  appInfo: { alignItems: 'center', paddingVertical: 16 },
  appInfoText: { fontSize: 14, color: Colors.textLight, fontWeight: '500' },
  versionText: { fontSize: 12, color: Colors.textLight, marginTop: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, width: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  modalDesc: { fontSize: 14, color: Colors.textSecondary, marginBottom: 16 },
  modalInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    color: Colors.text, marginBottom: 16, backgroundColor: Colors.background,
  },
  codeInput: { fontSize: 20, fontWeight: '700', letterSpacing: 3, textAlign: 'center' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' },
  modalCancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelText: { color: Colors.textSecondary, fontSize: 16, fontWeight: '500' },
  confirmBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

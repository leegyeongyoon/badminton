import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Share,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

export default function ClubsScreen() {
  const { clubs, fetchClubs, createClub, joinClub, isLoading } = useClubStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    fetchClubs();
  }, []);

  const handleCreate = async () => {
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

  const handleJoin = async () => {
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
      await Share.share({
        message: `${Strings.app.name} - ${name} 모임에 참여하세요! 초대코드: ${code}`,
      });
    } catch { /* silent */ }
  };

  const renderClub = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.clubCard}
      onPress={() => router.push(`/club/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.clubCardLeft}>
        <View style={styles.clubAvatar}>
          <Text style={styles.clubAvatarText}>{item.name[0]}</Text>
        </View>
        <View style={styles.clubInfo}>
          <Text style={styles.clubName}>{item.name}</Text>
          <View style={styles.clubMetaRow}>
            <Text style={styles.clubMeta}>
              {Strings.club.members} {item.memberCount}명
            </Text>
            {item.isLeader && (
              <View style={styles.leaderBadge}>
                <Text style={styles.leaderBadgeText}>대표</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.clubRight}>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={(e) => {
            e.stopPropagation();
            handleShareInvite(item.inviteCode, item.name);
          }}
        >
          <Text style={styles.shareIcon}>📤</Text>
        </TouchableOpacity>
        <View style={styles.inviteCodeBox}>
          <Text style={styles.inviteCodeLabel}>{Strings.club.inviteCode}</Text>
          <Text style={styles.inviteCode}>{item.inviteCode}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setShowCreateModal(true)}
        >
          <Text style={styles.actionButtonIcon}>+</Text>
          <Text style={styles.actionButtonText}>{Strings.club.create}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonSecondary]}
          onPress={() => setShowJoinModal(true)}
        >
          <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
            {Strings.club.join}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={clubs}
        renderItem={renderClub}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, clubs.length === 0 && { flexGrow: 1 }]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={fetchClubs} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyText}>{Strings.club.noClubs}</Text>
            <Text style={styles.emptySubText}>모임을 만들거나 초대코드로 가입하세요</Text>
          </View>
        }
      />

      {/* Create Modal */}
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
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setShowCreateModal(false); setClubName(''); }}
              >
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, !clubName.trim() && { opacity: 0.5 }]}
                onPress={handleCreate}
                disabled={!clubName.trim()}
              >
                <Text style={styles.confirmText}>{Strings.common.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join Modal */}
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
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setShowJoinModal(false); setInviteCode(''); }}
              >
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, !inviteCode.trim() && { opacity: 0.5 }]}
                onPress={handleJoin}
                disabled={!inviteCode.trim()}
              >
                <Text style={styles.confirmText}>{Strings.common.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  actionButtonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  actionButtonIcon: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  actionButtonTextSecondary: {
    color: Colors.primary,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  // Club card
  clubCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  clubCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  clubAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  clubInfo: {
    flex: 1,
  },
  clubName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  clubMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clubMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  leaderBadge: {
    backgroundColor: Colors.warning + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  leaderBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.warning,
  },
  clubRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  shareButton: {
    padding: 4,
  },
  shareIcon: {
    fontSize: 16,
  },
  inviteCodeBox: {
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inviteCodeLabel: {
    fontSize: 9,
    color: Colors.textLight,
  },
  inviteCode: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 1,
  },
  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubText: {
    textAlign: 'center',
    color: Colors.textLight,
    fontSize: 14,
    marginTop: 4,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    marginBottom: 16,
    backgroundColor: Colors.background,
  },
  codeInput: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

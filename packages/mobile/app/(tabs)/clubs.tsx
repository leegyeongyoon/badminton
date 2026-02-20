import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

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
      Alert.alert('오류', err.response?.data?.error || '모임 생성에 실패했습니다');
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
      Alert.alert('오류', err.response?.data?.error || '모임 가입에 실패했습니다');
    }
  };

  const renderClub = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.clubCard}
      onPress={() => router.push(`/club/${item.id}`)}
    >
      <View style={styles.clubInfo}>
        <Text style={styles.clubName}>{item.name}</Text>
        <Text style={styles.clubMeta}>
          {Strings.club.members} {item.memberCount}명
          {item.isLeader && ' · 리더'}
        </Text>
      </View>
      <View style={styles.inviteCodeBox}>
        <Text style={styles.inviteCodeLabel}>{Strings.club.inviteCode}</Text>
        <Text style={styles.inviteCode}>{item.inviteCode}</Text>
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
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{Strings.club.noClubs}</Text>
        }
      />

      {/* Create Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{Strings.club.create}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="모임 이름"
              value={clubName}
              onChangeText={setClubName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleCreate}>
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
            <TextInput
              style={styles.modalInput}
              placeholder="초대코드 8자리"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              maxLength={8}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowJoinModal(false)}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleJoin}>
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
  },
  actionButtonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
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
  },
  clubCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
  clubMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  inviteCodeBox: {
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inviteCodeLabel: {
    fontSize: 10,
    color: Colors.textLight,
  },
  inviteCode: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textSecondary,
    marginTop: 40,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    alignItems: 'center',
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

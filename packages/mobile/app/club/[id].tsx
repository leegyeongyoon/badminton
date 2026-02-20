import { useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { Colors } from '../../constants/colors';

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentMembers, fetchMembers, clubs } = useClubStore();

  const club = clubs.find((c) => c.id === id);

  useEffect(() => {
    if (id) fetchMembers(id);
  }, [id]);

  const renderMember = ({ item }: { item: any }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberAvatar}>
        <Text style={styles.avatarText}>{item.name[0]}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {item.name}
          {item.isLeader && <Text style={styles.leaderBadge}> 리더</Text>}
        </Text>
      </View>
      <View style={[styles.statusDot, item.isCheckedIn && styles.statusDotActive]} />
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: club?.name || '모임' }} />
      <View style={styles.container}>
        {club && (
          <View style={styles.infoCard}>
            <Text style={styles.inviteLabel}>초대코드</Text>
            <Text style={styles.inviteCode}>{club.inviteCode}</Text>
          </View>
        )}
        <Text style={styles.sectionTitle}>멤버 ({currentMembers.length}명)</Text>
        <FlatList
          data={currentMembers}
          renderItem={renderMember}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={styles.list}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inviteLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  inviteCode: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
  },
  memberCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  leaderBadge: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '700',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.textLight,
  },
  statusDotActive: {
    backgroundColor: Colors.secondary,
  },
});

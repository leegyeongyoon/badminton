import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useFacilityStore } from '../../store/facilityStore';
import { Colors } from '../../constants/colors';
import api from '../../services/api';

interface Penalty {
  id: string;
  userId: string;
  gameId: string;
  facilityId: string;
  occurredAt: string;
  penaltyEndsAt: string | null;
}

export default function PenaltiesScreen() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { selectedFacility } = useFacilityStore();
  const facilityId = checkinStatus?.facilityId || selectedFacility?.id;

  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPenalties = useCallback(async () => {
    if (!facilityId) return;
    try {
      const res = await api.get(`/penalties/facilities/${facilityId}/penalties`);
      setPenalties(res.data || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    loadPenalties();
  }, [loadPenalties]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPenalties();
    setRefreshing(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const isActive = (penalty: Penalty) => {
    if (!penalty.penaltyEndsAt) return false;
    return new Date(penalty.penaltyEndsAt) > new Date();
  };

  const renderPenalty = ({ item }: { item: Penalty }) => {
    const active = isActive(item);
    return (
      <View style={[styles.penaltyCard, active && styles.penaltyCardActive]}>
        <View style={styles.penaltyHeader}>
          <View style={[styles.statusBadge, { backgroundColor: active ? Colors.dangerLight : Colors.divider }]}>
            <Text style={[styles.statusText, { color: active ? Colors.danger : Colors.textLight }]}>
              {active ? '활성' : '만료'}
            </Text>
          </View>
          <Text style={styles.penaltyUserId}>사용자: {item.userId.slice(0, 8)}...</Text>
        </View>
        <View style={styles.penaltyDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>발생 일시</Text>
            <Text style={styles.detailValue}>{formatDate(item.occurredAt)}</Text>
          </View>
          {item.penaltyEndsAt && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>패널티 종료</Text>
              <Text style={[styles.detailValue, active && { color: Colors.danger, fontWeight: '600' }]}>
                {formatDate(item.penaltyEndsAt)}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>{'<'} 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>패널티 관리</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={penalties}
        keyExtractor={(item) => item.id}
        renderItem={renderPenalty}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>활성 패널티가 없습니다</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 60,
  },
  backBtnText: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  penaltyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  penaltyCardActive: {
    borderColor: Colors.danger,
    borderWidth: 1,
  },
  penaltyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  penaltyUserId: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  penaltyDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    color: Colors.text,
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
});

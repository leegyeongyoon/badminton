import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

export interface Capacity {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
  totalTurnSlots: number;
  usedTurnSlots: number;
}

interface CapacityBarProps {
  capacity: Capacity;
}

export function CapacityBar({ capacity }: CapacityBarProps) {
  const total = capacity.totalCheckedIn || 1;
  return (
    <View style={styles.container}>
      <Text style={styles.totalHeader}>전체 {capacity.totalCheckedIn}명</Text>
      <View style={styles.row}>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: Colors.playerAvailable }]} />
          <Text style={styles.statLabel}>가용</Text>
          <Text style={[styles.statNumber, { color: Colors.playerAvailable }]}>{capacity.availableCount}</Text>
        </View>
        <Text style={styles.separator}>|</Text>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: Colors.playerInTurn }]} />
          <Text style={styles.statLabel}>게임</Text>
          <Text style={[styles.statNumber, { color: Colors.playerInTurn }]}>{capacity.inTurnCount}</Text>
        </View>
        <Text style={styles.separator}>|</Text>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: Colors.playerResting }]} />
          <Text style={styles.statLabel}>휴식</Text>
          <Text style={[styles.statNumber, { color: Colors.playerResting }]}>{capacity.restingCount}</Text>
        </View>
      </View>
      <View style={styles.progressBar}>
        {capacity.availableCount > 0 && (
          <View style={[styles.segment, { flex: capacity.availableCount / total, backgroundColor: Colors.playerAvailable }]} />
        )}
        {capacity.inTurnCount > 0 && (
          <View style={[styles.segment, { flex: capacity.inTurnCount / total, backgroundColor: Colors.playerInTurn }]} />
        )}
        {capacity.restingCount > 0 && (
          <View style={[styles.segment, { flex: capacity.restingCount / total, backgroundColor: Colors.playerResting }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  totalHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
  },
  separator: {
    fontSize: 16,
    color: Colors.divider,
    fontWeight: '300',
    marginHorizontal: 4,
  },
  progressBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  segment: {
    height: 10,
  },
});

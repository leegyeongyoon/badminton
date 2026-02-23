import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

export interface Recruitment {
  id: string;
  createdById: string;
  createdByName: string;
  gameType: string;
  playersRequired: number;
  status: string;
  message: string | null;
  members: { userId: string; userName: string }[];
  expiresAt: string;
}

interface RecruitmentSectionProps {
  recruitments: Recruitment[];
  userId?: string;
  isCheckedIn: boolean;
  onJoin: (recruitmentId: string) => void;
  onLeave: (recruitmentId: string) => void;
  onRegister: (recruitmentId: string) => void;
  onCreatePress: () => void;
}

function formatExpiryTime(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return '만료됨';
  const minutes = Math.floor(remaining / 60000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return `${minutes}분`;
}

export function RecruitmentSection({
  recruitments,
  userId,
  isCheckedIn,
  onJoin,
  onLeave,
  onRegister,
  onCreatePress,
}: RecruitmentSectionProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (recruitments.length === 0) return null;

  const displayList = collapsed ? recruitments.slice(0, 2) : recruitments;

  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <TouchableOpacity
          style={styles.titleRow}
          onPress={() => setCollapsed((prev) => !prev)}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionTitle}>{Strings.recruitment.title}</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{recruitments.length}</Text>
          </View>
          <Text style={styles.collapseIcon}>{collapsed ? '▼' : '▲'}</Text>
        </TouchableOpacity>
        {isCheckedIn && (
          <TouchableOpacity onPress={onCreatePress}>
            <Text style={styles.createBtn}>{Strings.recruitment.create}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recruitment cards */}
      {displayList.map((r) => (
        <RecruitmentCard
          key={r.id}
          recruitment={r}
          userId={userId}
          isCheckedIn={isCheckedIn}
          onJoin={onJoin}
          onLeave={onLeave}
          onRegister={onRegister}
        />
      ))}

      {/* Show more / less toggle */}
      {recruitments.length > 2 && (
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => setCollapsed((prev) => !prev)}
        >
          <Text style={styles.toggleText}>
            {collapsed ? `${recruitments.length - 2}개 더 보기` : '접기'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ---------- Individual card ---------- */

function RecruitmentCard({
  recruitment: r,
  userId,
  isCheckedIn,
  onJoin,
  onLeave,
  onRegister,
}: {
  recruitment: Recruitment;
  userId?: string;
  isCheckedIn: boolean;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onRegister: (id: string) => void;
}) {
  const isMember = r.members.some((m) => m.userId === userId);
  const isCreator = r.createdById === userId;
  const isFull = r.members.length >= r.playersRequired;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.gameType}>
          {Strings.court.gameType[r.gameType as keyof typeof Strings.court.gameType] || r.gameType}
        </Text>
        <View style={styles.headerRight}>
          {r.expiresAt && (
            <Text style={styles.expiry}>{formatExpiryTime(r.expiresAt)}</Text>
          )}
          <Text style={styles.count}>
            {r.members.length}/{r.playersRequired}
          </Text>
        </View>
      </View>

      <Text style={styles.members}>
        {r.members.map((m) => m.userName).join(', ')}
        {!isFull && ` + ${r.playersRequired - r.members.length}명 모집중`}
      </Text>

      {r.message && (
        <Text style={styles.message}>"{r.message}"</Text>
      )}

      {isCheckedIn && (
        <View style={styles.actions}>
          {!isMember && !isFull && r.status === 'RECRUITING' && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.secondary }]}
              onPress={() => onJoin(r.id)}
            >
              <Text style={styles.actionBtnText}>{Strings.recruitment.join}</Text>
            </TouchableOpacity>
          )}
          {isMember && !isCreator && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.danger }]}
              onPress={() => onLeave(r.id)}
            >
              <Text style={styles.actionBtnText}>{Strings.recruitment.leave}</Text>
            </TouchableOpacity>
          )}
          {isCreator && isFull && r.status === 'FULL' && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
              onPress={() => onRegister(r.id)}
            >
              <Text style={styles.actionBtnText}>{Strings.recruitment.register}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  countBadge: {
    backgroundColor: Colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  collapseIcon: {
    fontSize: 10,
    color: Colors.textLight,
    marginLeft: 2,
  },
  createBtn: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  toggleBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  toggleText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
  },
  // Card
  card: {
    backgroundColor: Colors.recruitmentBg,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.secondary + '40',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  gameType: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expiry: {
    fontSize: 11,
    color: Colors.warning,
    fontWeight: '500',
  },
  count: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  members: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  message: {
    fontSize: 11,
    color: Colors.textLight,
    fontStyle: 'italic',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});

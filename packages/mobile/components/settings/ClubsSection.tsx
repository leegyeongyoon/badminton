import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Divider } from '../ui/Divider';
import { EmptyState } from '../ui/EmptyState';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';

interface Club {
  id: string;
  name: string;
  memberCount: number;
  isLeader?: boolean;
  inviteCode: string;
}

interface ClubsSectionProps {
  clubs: Club[];
  onCreateClub: () => void;
  onJoinClub: () => void;
  onClubPress: (clubId: string) => void;
  onShareInvite: (code: string, name: string) => void;
}

export function ClubsSection({
  clubs,
  onCreateClub,
  onJoinClub,
  onClubPress,
  onShareInvite,
}: ClubsSectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{Strings.settings.clubs}</Text>
        <View style={styles.headerActions}>
          <Button
            title={Strings.club.create}
            onPress={onCreateClub}
            variant="primary"
            size="sm"
            icon="add"
          />
          <Button
            title={Strings.club.join}
            onPress={onJoinClub}
            variant="outline"
            size="sm"
          />
        </View>
      </View>

      <Card variant="elevated" style={styles.card}>
        {clubs.length === 0 ? (
          <EmptyState
            icon="club"
            title={Strings.club.noClubs}
            description="모임을 만들거나 초대코드로 참여하세요"
          />
        ) : (
          clubs.map((club: Club, idx: number) => (
            <React.Fragment key={club.id}>
              {idx > 0 && <Divider spacing={0} />}
              <TouchableOpacity
                style={styles.clubItem}
                onPress={() => onClubPress(club.id)}
                activeOpacity={0.6}
              >
                <View
                  style={[
                    styles.clubAvatar,
                    { backgroundColor: alpha(colors.avatarColors[idx % colors.avatarColors.length], 0.1) },
                  ]}
                >
                  <Text
                    style={[
                      styles.clubAvatarText,
                      { color: colors.avatarColors[idx % colors.avatarColors.length] },
                    ]}
                  >
                    {club.name[0]}
                  </Text>
                </View>
                <View style={styles.clubInfo}>
                  <Text style={[styles.clubName, { color: colors.text }]} numberOfLines={1}>{club.name}</Text>
                  <View style={styles.clubMeta}>
                    <Text style={[styles.clubMetaText, { color: colors.textSecondary }]}>
                      {Strings.club.members} {club.memberCount}명
                    </Text>
                    {club.isLeader && (
                      <Badge label="대표" variant="filled" color="warning" size="sm" />
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    onShareInvite(club.inviteCode, club.name);
                  }}
                  activeOpacity={0.6}
                >
                  <View style={[styles.shareBtnInner, { backgroundColor: colors.background }]}>
                    <Icon name="share" size={16} color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>
                <Icon name="chevronRight" size={20} color={colors.textLight} />
              </TouchableOpacity>
            </React.Fragment>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.subtitle1,
    letterSpacing: 0.3,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  clubItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.mlg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  clubAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubAvatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  clubInfo: {
    flex: 1,
  },
  clubName: {
    ...typography.subtitle1,
  },
  clubMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  clubMetaText: {
    ...typography.caption,
  },
  shareBtn: {
    padding: spacing.xs,
  },
  shareBtnInner: {
    width: 34,
    height: 34,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

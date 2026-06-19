import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { getSkillMeta } from '../../constants/skill';
import { getGenderMeta } from '../../constants/gender';
import { typography, spacing, radius, palette } from '../../constants/theme';

export interface PlayerCardData {
  userId: string;
  userName?: string;
  name?: string;
  skillLevel?: string | null;
  gender?: string | null;
  status?: string;
  gamesPlayedToday?: number;
  isGuest?: boolean;
}

interface PlayerCardProps {
  player: PlayerCardData;
  /** Tap handler (e.g. stage into the tray). Omit for read-only display. */
  onPress?: () => void;
  /** Renders a 1-based order number badge instead of the skill avatar. */
  stagedIndex?: number | null;
  /** Dim + disable (already assigned to a game). */
  dimmed?: boolean;
  /** Highlight border (staged / "me"). */
  highlighted?: boolean;
  /** Show the "N게임" footer line. Default true. */
  showGames?: boolean;
  /** Compact on-court variant: smaller avatar, no footer, no status tint. */
  variant?: 'grid' | 'court';
  /** Appended to the name, e.g. " (나)". */
  nameSuffix?: string;
  /**
   * Double-booked (already in another game's roster). Shows a SMALL subtle red
   * dot in the top-right corner — informational only, never disables the card.
   */
  busy?: boolean;
  style?: ViewStyle;
}

/**
 * One player, shown compactly for scannable rosters:
 *  - a COMPACT 급수 mark (small colored letter S/A/B/C/D/E/F) inline before the name
 *  - name + a GENDER marker (♂ blue / ♀ rose) that's distinguishable at a glance
 *  - 게스트 badge when isGuest
 *  - a left status tint bar (대기 green / 게임중 red / 휴식 amber)
 *  - "N게임" footer for fairness scanning
 *
 * Designed to wrap into a multi-column grid so a leader can scan 24+ people.
 */
export function PlayerCard({
  player,
  onPress,
  stagedIndex = null,
  dimmed = false,
  highlighted = false,
  showGames = true,
  variant = 'grid',
  nameSuffix = '',
  busy = false,
  style,
}: PlayerCardProps) {
  const { colors } = useTheme();
  const skill = getSkillMeta(player.skillLevel);
  const genderMeta = getGenderMeta(player.gender);
  const name = player.userName || player.name || '?';
  const status = player.status;
  const isCourt = variant === 'court';

  const statusColor =
    status === 'RESTING'
      ? colors.playerResting
      : status === 'IN_TURN'
        ? colors.playerInTurn
        : colors.playerAvailable;

  // Staged order-number badge MUST be the exact same footprint as the 급수
  // skillTag (18×18). The leading element drives the name's flex width, so if
  // the badge were larger the name box would shrink the moment a player is
  // staged/selected — that's the "이름표가 작아진다" bug. Keep them identical.
  const stagedDim = 18;

  const borderColor = highlighted ? colors.primary : colors.border;
  const bg = highlighted ? colors.primaryLight : colors.surface;

  const content = (
    <>
      {/* status tint rail (grid only) */}
      {!isCourt && <View style={[styles.statusRail, { backgroundColor: statusColor }]} />}

      {/* COMPACT 급수 mark OR staged number */}
      {stagedIndex != null ? (
        <View style={[styles.staged, { width: stagedDim, height: stagedDim, backgroundColor: colors.primary }]}>
          <Text style={styles.stagedText}>{stagedIndex}</Text>
        </View>
      ) : (
        <View style={[styles.skillTag, { borderColor: skill.color, backgroundColor: colors.surface }]}>
          <Text style={[styles.skillTagText, { color: skill.color, fontSize: isCourt ? 11 : 12 }]}>
            {(player.skillLevel || '·').toUpperCase()}
          </Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text
            style={[
              isCourt ? styles.nameCourt : styles.name,
              { color: highlighted ? colors.primary : colors.text },
            ]}
            numberOfLines={1}
          >
            {name}{nameSuffix}
          </Text>
          {genderMeta && (
            <Text style={[styles.genderSymbol, { color: genderMeta.color }]}>{genderMeta.symbol}</Text>
          )}
        </View>

        {(player.isGuest || (showGames && !isCourt)) && (
          <View style={styles.metaRow}>
            {player.isGuest && (
              <View style={[styles.guestTag, { backgroundColor: colors.warningLight }]}>
                <Text style={[styles.guestTagText, { color: colors.warning }]}>게스트</Text>
              </View>
            )}
            {showGames && !isCourt && (
              <Text style={[styles.games, { color: colors.textSecondary }]}>
                {status === 'RESTING'
                  ? '휴식'
                  : status === 'IN_TURN' && stagedIndex == null
                    ? '게임중'
                    : `${player.gamesPlayedToday ?? 0}게임`}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Double-booking is ALLOWED — never blocked/dimmed for conflict. A small,
          subtle RED DOT in the top-right corner is the only conflict cue. */}
      {busy && <View style={[styles.conflictDot, { borderColor: bg }]} />}
    </>
  );

  const containerStyle = [
    isCourt ? styles.containerCourt : styles.container,
    { backgroundColor: bg, borderColor },
    // NOTE: do NOT bump borderWidth on highlight. The base border is already
    // 1.5px; growing it to 2px on select pulls the inner content box inward,
    // which visibly SHRINKS the name's layout box. Highlight only changes
    // color/background so the tile + name dimensions stay pixel-identical
    // between unselected and selected states.
    dimmed && styles.dimmed,
    style,
  ];

  if (onPress && !dimmed) {
    return (
      <TouchableOpacity style={containerStyle} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={containerStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingLeft: spacing.smd,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 38,
    overflow: 'hidden',
  },
  containerCourt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 32,
  },
  dimmed: { opacity: 0.45 },

  statusRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },

  // Compact 급수 mark: a tiny rounded square with the colored 급수 letter on a
  // thin colored border — far lighter than the old filled circle, so tiles shrink.
  skillTag: {
    width: 18,
    height: 18,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillTagText: { fontWeight: '900' },

  staged: {
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagedText: { color: palette.white, fontSize: 11, fontWeight: '800' },

  body: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { ...typography.subtitle2, flexShrink: 1 },
  nameCourt: { ...typography.body2, fontWeight: '700', flexShrink: 1 },

  // Gender marker = a BARE colored ♂/♀ glyph (no tinted pill). Bigger + bolder
  // + gender-colored (blue ♂ / rose ♀) so male/female pop at a glance.
  genderSymbol: { fontSize: 16, fontWeight: '900', lineHeight: 18 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  guestTag: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm },
  guestTagText: { fontSize: 10, fontWeight: '800' },
  games: { fontSize: 11, fontWeight: '700' },

  // Small, subtle conflict (double-booking) cue. Informational only — never
  // blocks the card. White ring (borderColor = card bg) lifts it off the tile.
  conflictDot: {
    position: 'absolute', top: 4, right: 4,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: palette.red500, borderWidth: 1,
  },
});

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
 *  - a FILLED 급수 chip (colored bg + readable white letter S/A/B/C/D/E/F)
 *    inline before the name
 *  - bigger name + a GENDER marker (♂ blue / ♀ rose) distinguishable at a glance
 *  - 게스트 badge when isGuest
 *  - a left status tint bar (대기 green / 게임중 red / 휴식 amber)
 *  - a legible "N게임" CHIP for fairness scanning (low / fair / high tint)
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
  const hasSkill = !!player.skillLevel;

  const statusColor =
    status === 'RESTING'
      ? colors.playerResting
      : status === 'IN_TURN'
        ? colors.playerInTurn
        : colors.playerAvailable;

  // Staged order-number badge MUST share the exact footprint as the 급수 chip so
  // the name's flex width never jumps when a player is staged/selected ("이름표가
  // 작아진다" bug). The chip is a touch wider on the grid variant now (filled +
  // bigger letter), so keep the staged badge identical in both variants.
  const chipDim = isCourt ? 20 : 22;

  const borderColor = highlighted ? colors.primary : colors.border;
  const bg = highlighted ? colors.primaryLight : colors.surface;

  // ── "N게임" fairness chip ──────────────────────────────────
  // Tasteful at-a-glance cue: 0게임 reads as a soft "처음" (needs a game),
  // 3+ games reads warm (played a lot). Mid counts stay neutral.
  const games = player.gamesPlayedToday ?? 0;
  const gameTint =
    games === 0
      ? { bg: colors.secondaryBg, fg: colors.secondary }
      : games >= 3
        ? { bg: colors.warningBg, fg: colors.warning }
        : { bg: colors.surfaceSecondary, fg: colors.textSecondary };

  const content = (
    <>
      {/* status tint rail (grid only) */}
      {!isCourt && <View style={[styles.statusRail, { backgroundColor: statusColor }]} />}

      {/* FILLED 급수 chip OR staged number */}
      {stagedIndex != null ? (
        <View style={[styles.staged, { width: chipDim, height: chipDim, backgroundColor: colors.primary }]}>
          <Text style={styles.stagedText}>{stagedIndex}</Text>
        </View>
      ) : (
        <View
          style={[
            styles.skillTag,
            { width: chipDim, height: chipDim },
            hasSkill
              ? { backgroundColor: skill.color, borderColor: skill.color }
              : { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.skillTagText,
              { color: hasSkill ? palette.white : colors.textLight, fontSize: isCourt ? 12 : 13 },
            ]}
          >
            {hasSkill ? (player.skillLevel || '').toUpperCase() : '·'}
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
              status === 'RESTING' ? (
                <View style={[styles.gamesChip, { backgroundColor: colors.warningBg }]}>
                  <Text style={[styles.gamesChipText, { color: colors.warning }]}>휴식</Text>
                </View>
              ) : status === 'IN_TURN' && stagedIndex == null ? (
                <View style={[styles.gamesChip, { backgroundColor: colors.dangerBg }]}>
                  <Text style={[styles.gamesChipText, { color: colors.playerInTurn }]}>게임중</Text>
                </View>
              ) : (
                <View style={[styles.gamesChip, { backgroundColor: gameTint.bg }]}>
                  <Text style={[styles.gamesChipText, { color: gameTint.fg }]}>{games}게임</Text>
                </View>
              )
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 46,
    overflow: 'hidden',
  },
  containerCourt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 38,
  },
  dimmed: { opacity: 0.45 },

  statusRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },

  // FILLED 급수 chip: a solid rounded square in the 급수 color with a readable
  // white letter — far higher-contrast than the old border-only mark, so it
  // pops at arm's length. Width/height set inline (court vs grid).
  skillTag: {
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
  stagedText: { color: palette.white, fontSize: 12, fontWeight: '800' },

  body: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { ...typography.subtitle1, flexShrink: 1 },
  nameCourt: { ...typography.subtitle2, fontSize: 15, flexShrink: 1 },

  // Gender marker = a BARE colored ♂/♀ glyph (no tinted pill). Bigger + bolder
  // + gender-colored (blue ♂ / rose ♀) so male/female pop at a glance.
  genderSymbol: { fontSize: 17, fontWeight: '900', lineHeight: 19 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  guestTag: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm },
  guestTagText: { fontSize: 10, fontWeight: '800' },

  // "N게임" is now a legible filled chip (was a tiny low-contrast caption).
  gamesChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  gamesChipText: { fontSize: 12, fontWeight: '800' },

  // Small, subtle conflict (double-booking) cue. Informational only — never
  // blocks the card. White ring (borderColor = card bg) lifts it off the tile.
  conflictDot: {
    position: 'absolute', top: 4, right: 4,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: palette.red500, borderWidth: 1,
  },
});

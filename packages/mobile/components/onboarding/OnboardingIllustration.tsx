import React from 'react';
import { View, StyleSheet } from 'react-native';
import { palette } from '../../constants/theme';

/**
 * View-based illustrations for onboarding pages.
 * Uses simple shapes with theme palette colors — no external images needed.
 */

// ─── Court Illustration ─────────────────────────────────────
// A rectangle grid pattern with colored dots representing players.
export function CourtIllustration() {
  const courtColor = palette.green500;
  const lineColor = palette.white;

  return (
    <View style={courtStyles.wrapper}>
      <View style={[courtStyles.court, { backgroundColor: courtColor }]}>
        {/* Horizontal center line */}
        <View style={[courtStyles.hLine, { backgroundColor: lineColor }]} />
        {/* Vertical center line */}
        <View style={[courtStyles.vLine, { backgroundColor: lineColor }]} />
        {/* Service lines */}
        <View style={[courtStyles.serviceLineTop, { backgroundColor: lineColor }]} />
        <View style={[courtStyles.serviceLineBottom, { backgroundColor: lineColor }]} />
        {/* Border */}
        <View style={[courtStyles.border, { borderColor: lineColor }]} />

        {/* Player dots */}
        <View style={[courtStyles.player, { backgroundColor: palette.blue500, top: 30, left: 40 }]} />
        <View style={[courtStyles.player, { backgroundColor: palette.blue500, top: 30, right: 40 }]} />
        <View style={[courtStyles.player, { backgroundColor: palette.red500, bottom: 30, left: 40 }]} />
        <View style={[courtStyles.player, { backgroundColor: palette.red500, bottom: 30, right: 40 }]} />
      </View>

      {/* Additional courts (smaller, behind) */}
      <View style={[courtStyles.miniCourt, { backgroundColor: palette.green600, left: -20, top: 20 }]} />
      <View style={[courtStyles.miniCourt, { backgroundColor: palette.green600, right: -20, top: 20 }]} />
    </View>
  );
}

const courtStyles = StyleSheet.create({
  wrapper: {
    width: 200,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  court: {
    width: 160,
    height: 140,
    borderRadius: 8,
    position: 'relative',
    zIndex: 1,
  },
  hLine: {
    position: 'absolute',
    top: '50%',
    left: 8,
    right: 8,
    height: 2,
  },
  vLine: {
    position: 'absolute',
    left: '50%',
    top: 8,
    bottom: 8,
    width: 2,
  },
  serviceLineTop: {
    position: 'absolute',
    top: '30%',
    left: 8,
    right: 8,
    height: 1,
    opacity: 0.6,
  },
  serviceLineBottom: {
    position: 'absolute',
    bottom: '30%',
    left: 8,
    right: 8,
    height: 1,
    opacity: 0.6,
  },
  border: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: 2,
    borderRadius: 4,
  },
  player: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  miniCourt: {
    position: 'absolute',
    width: 80,
    height: 100,
    borderRadius: 6,
    opacity: 0.3,
    zIndex: 0,
  },
});

// ─── Registration Illustration ──────────────────────────────
// A phone outline with a card rising up from it.
export function RegistrationIllustration() {
  return (
    <View style={regStyles.wrapper}>
      {/* Phone body */}
      <View style={[regStyles.phone, { borderColor: palette.slate300, backgroundColor: palette.slate50 }]}>
        {/* Notch */}
        <View style={[regStyles.notch, { backgroundColor: palette.slate300 }]} />

        {/* Content area */}
        <View style={regStyles.contentArea}>
          {/* Placeholder lines */}
          <View style={[regStyles.line, { backgroundColor: palette.slate200, width: '60%' }]} />
          <View style={[regStyles.line, { backgroundColor: palette.slate200, width: '80%' }]} />
          <View style={[regStyles.line, { backgroundColor: palette.slate200, width: '40%' }]} />
        </View>

        {/* Rising card */}
        <View style={[regStyles.risingCard, { backgroundColor: palette.blue500 }]}>
          <View style={[regStyles.cardLine, { backgroundColor: palette.white }]} />
          <View style={[regStyles.cardDot, { backgroundColor: palette.white }]} />
          <View style={[regStyles.cardLineShort, { backgroundColor: palette.blue100 }]} />
        </View>
      </View>

      {/* Tap indicator */}
      <View style={[regStyles.tapCircle, { borderColor: palette.blue500 }]}>
        <View style={[regStyles.tapDot, { backgroundColor: palette.blue500 }]} />
      </View>
    </View>
  );
}

const regStyles = StyleSheet.create({
  wrapper: {
    width: 160,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: {
    width: 120,
    height: 180,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: 'center',
    paddingTop: 20,
    overflow: 'hidden',
  },
  notch: {
    width: 40,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
    top: 8,
  },
  contentArea: {
    width: '80%',
    gap: 8,
    marginTop: 16,
  },
  line: {
    height: 6,
    borderRadius: 3,
  },
  risingCard: {
    position: 'absolute',
    bottom: 10,
    width: 90,
    height: 60,
    borderRadius: 10,
    padding: 10,
    gap: 6,
    alignItems: 'flex-start',
  },
  cardLine: {
    width: '70%',
    height: 4,
    borderRadius: 2,
  },
  cardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardLineShort: {
    width: '50%',
    height: 4,
    borderRadius: 2,
  },
  tapCircle: {
    position: 'absolute',
    bottom: 8,
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  tapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});

// ─── Community Illustration ─────────────────────────────────
// A circle of player avatars connected by lines.
export function CommunityIllustration() {
  const avatarColors = [
    palette.blue500,
    palette.green500,
    palette.amber500,
    palette.red500,
    palette.violet500,
    '#EC4899',
  ];

  const positions = [
    { top: 0, left: 65 },     // top center
    { top: 25, right: 10 },   // top right
    { bottom: 25, right: 10 },// bottom right
    { bottom: 0, left: 65 },  // bottom center
    { bottom: 25, left: 10 }, // bottom left
    { top: 25, left: 10 },    // top left
  ];

  return (
    <View style={commStyles.wrapper}>
      {/* Center hub */}
      <View style={[commStyles.hub, { backgroundColor: palette.blue100, borderColor: palette.blue500 }]}>
        <View style={[commStyles.hubIcon, { backgroundColor: palette.blue500 }]} />
      </View>

      {/* Avatar circles */}
      {avatarColors.map((color, idx) => (
        <View
          key={idx}
          style={[
            commStyles.avatar,
            { backgroundColor: color },
            positions[idx] as any,
          ]}
        >
          <View style={commStyles.avatarInner} />
        </View>
      ))}

      {/* Connection lines (decorative) */}
      <View style={[commStyles.connLine, { backgroundColor: palette.slate200, transform: [{ rotate: '0deg' }], top: 75 }]} />
      <View style={[commStyles.connLine, { backgroundColor: palette.slate200, transform: [{ rotate: '60deg' }], top: 75 }]} />
      <View style={[commStyles.connLine, { backgroundColor: palette.slate200, transform: [{ rotate: '120deg' }], top: 75 }]} />
    </View>
  );
}

const commStyles = StyleSheet.create({
  wrapper: {
    width: 170,
    height: 170,
    position: 'relative',
  },
  hub: {
    position: 'absolute',
    top: 55,
    left: 55,
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  avatar: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  avatarInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  connLine: {
    position: 'absolute',
    left: 30,
    width: 110,
    height: 1,
    opacity: 0.4,
    zIndex: 0,
  },
});

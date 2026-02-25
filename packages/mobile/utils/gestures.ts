/**
 * Gesture presets and utilities for swipe, tilt, and drag interactions.
 * Used by SwipeableCard, CourtCard tilt, and other gesture-driven components.
 */

/** Minimum distance/velocity thresholds to trigger a swipe action. */
export const swipeThresholds = {
  /** Minimum horizontal swipe distance (px) to trigger action */
  distance: 80,
  /** Minimum velocity (px/s) to trigger action regardless of distance */
  velocity: 500,
};

/** Spring config for snapping back after a swipe release. */
export const swipeSpring = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

/** Tilt configuration for press-to-tilt effects (e.g. CourtCard). */
export const tiltConfig = {
  /** Maximum tilt angle in degrees */
  maxAngle: 3,
  /** Duration (ms) for the tilt transition */
  duration: 150,
};

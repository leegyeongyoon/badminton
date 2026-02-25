/**
 * Scroll-driven animation hook.
 * Provides a shared scrollY value, an animated scroll handler,
 * and derived styles for parallax headers and fading content.
 */
import {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

export function useScrollAnimation() {
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  /** Fades out and slides up over 0..150 scroll range. */
  const headerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 150], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, 150],
          [0, -50],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return { scrollY, scrollHandler, headerStyle };
}

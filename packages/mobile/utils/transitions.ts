/**
 * Screen transition presets for expo-router Stack screens.
 */
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const transitions = {
  slideFromRight: {
    animation: 'slide_from_right',
  } as NativeStackNavigationOptions,

  modalSlideUp: {
    presentation: 'modal',
    animation: 'slide_from_bottom',
  } as NativeStackNavigationOptions,

  fadeScale: {
    animation: 'fade',
  } as NativeStackNavigationOptions,

  none: {
    animation: 'none',
  } as NativeStackNavigationOptions,
};

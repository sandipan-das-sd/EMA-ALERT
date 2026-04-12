/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const navyLight = '#0E1E3A';
const navyDark = '#0A1329';
const gold = '#D4A63A';

export const Colors = {
  light: {
    text: '#0E1E3A',
    background: '#F4F7FD',
    tint: navyLight,
    icon: '#57719D',
    tabIconDefault: '#57719D',
    tabIconSelected: gold,
    card: '#FFFFFF',
    border: '#D8E3F5',
    accent: gold,
    muted: '#6C7FA3',
    success: '#0E9F6E',
    warning: '#C7821A',
    danger: '#C73E4A',
  },
  dark: {
    text: '#EDF2FF',
    background: navyDark,
    tint: '#9DB6E6',
    icon: '#8BA3CF',
    tabIconDefault: '#8BA3CF',
    tabIconSelected: gold,
    card: '#0F1D36',
    border: '#1D3258',
    accent: gold,
    muted: '#B6C8EA',
    success: '#2EC38A',
    warning: '#E7B24B',
    danger: '#F0717A',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif-medium',
    mono: 'monospace',
  },
  web: {
    sans: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'Avenir Next', 'Trebuchet MS', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

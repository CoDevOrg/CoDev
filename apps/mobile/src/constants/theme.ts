import { Platform } from "react-native";

/**
 * CoDev's brand palette, ported from apps/web/app/app-theme.css. The web app
 * is dark-mode only (no light variant is defined there), so both keys below
 * intentionally resolve to the same forest/beige/orange values — the mobile
 * app stays on-brand regardless of the device's system appearance setting.
 */
const palette = {
  forest950: "#0d1f17",
  forest900: "#142c22",
  forest800: "#1b3a2c",
  forest700: "#244633",
  beige100: "#f2ede0",
  beige200: "#ddd5c5",
  sage300: "#9db3a5",
  sage500: "#527e68",
  orange500: "#d9642c",
  orange400: "#e1732d",
} as const;

const semantic = {
  text: palette.beige100,
  textSecondary: palette.sage300,
  textMuted: "#7a9184",
  background: palette.forest950,
  backgroundElement: palette.forest900,
  backgroundSelected: palette.forest800,
  accent: palette.orange500,
  accentBright: palette.orange400,
  danger: "#ff6568",
  line: "rgba(242,237,224,0.1)",
  lineStrong: "rgba(217,101,45,0.32)",
} as const;

export const Colors = {
  light: semantic,
  dark: semantic,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

/** 8px grid, matching the apple-design skill's spacing scale. */
export const Spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
  xxl: 64,
  xxxl: 96,
} as const;

export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
} as const;

export const Motion = {
  duration: { fast: 150, base: 300, slow: 500 },
  easing: {
    inOut: [0.4, 0, 0.2, 1] as const,
    out: [0, 0, 0.2, 1] as const,
    in: [0.4, 0, 1, 1] as const,
  },
} as const;

export const StatusColors: Record<
  "idle" | "running" | "waiting" | "completed" | "interrupted" | "failed",
  string
> = {
  idle: semantic.textSecondary,
  running: semantic.accentBright,
  waiting: semantic.accent,
  completed: palette.sage500,
  interrupted: semantic.textMuted,
  failed: semantic.danger,
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

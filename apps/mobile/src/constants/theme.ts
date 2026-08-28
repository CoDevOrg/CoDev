import { Platform } from "react-native";

/**
 * CoDev's brand palette, ported from apps/web/app/app-theme.css. The web app
 * is dark-mode only (no light variant is defined there), so both keys below
 * intentionally resolve to the same black / ivory / dry-gold values — the
 * mobile app stays on-brand regardless of the device's system appearance.
 */
const palette = {
  black950: "#0a0908",
  black900: "#131210",
  black800: "#1c1b18",
  black700: "#27261f",
  beige100: "#f3efe6",
  beige200: "#d8d0c0",
  stone300: "#a39b8c",
  stone500: "#7a7368",
  gold500: "#c9a66b",
  gold400: "#d4b67a",
} as const;

const semantic = {
  text: palette.beige100,
  textSecondary: palette.stone300,
  textMuted: "#6e6860",
  background: palette.black950,
  backgroundElement: palette.black900,
  backgroundSelected: palette.black800,
  accent: palette.gold500,
  accentBright: palette.gold400,
  danger: "#ff6568",
  line: "rgba(243,239,230,0.1)",
  lineStrong: "rgba(201,166,107,0.32)",
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
  completed: "#4ea87a",
  interrupted: semantic.textMuted,
  failed: semantic.danger,
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

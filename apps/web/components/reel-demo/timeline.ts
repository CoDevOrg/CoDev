export const REEL_DURATION_MS = 28_000;

export const REEL_SCENES = [
  { name: "open", label: "Workspace", start: 0, stableAt: 2_100 },
  { name: "share", label: "Share", start: 3_000, stableAt: 6_500 },
  { name: "presence", label: "Presence", start: 7_000, stableAt: 8_400 },
  { name: "chat", label: "Team chat", start: 9_000, stableAt: 11_500 },
  { name: "agents", label: "Live agents", start: 12_000, stableAt: 16_800 },
  { name: "conflict", label: "Coordination", start: 18_000, stableAt: 21_500 },
  { name: "review", label: "Review", start: 23_000, stableAt: 27_500 },
] as const;

export type ReelSceneName = (typeof REEL_SCENES)[number]["name"];

export function isReelScene(value: unknown): value is ReelSceneName {
  return REEL_SCENES.some((scene) => scene.name === value);
}

export function sceneForElapsed(elapsed: number) {
  const clamped = Math.max(0, Math.min(elapsed, REEL_DURATION_MS));
  return (
    [...REEL_SCENES].reverse().find((scene) => clamped >= scene.start) ??
    REEL_SCENES[0]
  );
}

export function stableTimeForScene(name: ReelSceneName) {
  return REEL_SCENES.find((scene) => scene.name === name)?.stableAt ?? 0;
}

export function adjacentScene(name: ReelSceneName, direction: -1 | 1) {
  const index = REEL_SCENES.findIndex((scene) => scene.name === name);
  const next = Math.max(0, Math.min(index + direction, REEL_SCENES.length - 1));
  return REEL_SCENES[next]!;
}

export function typedPrefix(
  text: string,
  elapsed: number,
  start: number,
  end: number,
) {
  if (elapsed <= start) return "";
  if (elapsed >= end || end <= start) return text;

  const progress = (elapsed - start) / (end - start);
  return text.slice(0, Math.floor(progress * text.length));
}

/**
 * A member's or agent's colour for avatars, cursors and the follow frame.
 * Stable per id, so everyone sees the same person in the same colour.
 * Every colour carries white label text (`ink`) at 4.5:1 or better.
 */
const PALETTE = [
  { color: "#ce2c31", ink: "#ffffff" },
  { color: "#c94a00", ink: "#ffffff" },
  { color: "#9a6100", ink: "#ffffff" },
  { color: "#218358", ink: "#ffffff" },
  { color: "#0b7a70", ink: "#ffffff" },
  { color: "#0d6fc4", ink: "#ffffff" },
  { color: "#8145b5", ink: "#ffffff" },
  { color: "#c2298a", ink: "#ffffff" },
] as const;

export type MemberColor = (typeof PALETTE)[number];

export function memberColor(id: string): MemberColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length]!;
}

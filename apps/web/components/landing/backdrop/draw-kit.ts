export type Rgb = readonly [number, number, number];

export const EMBER: Rgb = [255, 105, 46];
export const GOLD: Rgb = [255, 211, 136];

export const ICE: Rgb = [232, 248, 255];
export const CYAN: Rgb = [110, 200, 255];
export const BLUE: Rgb = [50, 110, 255];
export const VIOLET: Rgb = [130, 95, 240];
export const LAVENDER: Rgb = [125, 145, 255];
export const TEAL: Rgb = [40, 170, 205];

/** One frame's shared geometry and animation state, passed to every layer. */
export interface Frame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since the scene started. */
  time: number;
  /** Tree growth, 0 (just the pillar) to `MAX_GROWTH` (fully grown). */
  growth: number;
  /** Growth clamped to 0..1, for things that stop changing once the trunk is up. */
  reveal: number;
  /** 0..1 once the canopy is mostly out; drives the edge swirls. */
  bloom: number;
  centerX: number;
  horizon: number;
  trunkTop: number;
  /** Unit length for the tree's own coordinate space, in CSS pixels. */
  unit: number;
  /** Parallax offsets derived from the pointer. */
  parallaxX: number;
  parallaxY: number;
  lite: boolean;
}

export const MAX_GROWTH = 1.7;

export const clamp = (value: number, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, value));

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const rgba = (color: Rgb, alpha: number): string =>
  `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${clamp(alpha)})`;

/** Index into an array that is known to be long enough. */
export function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
}

/** Small deterministic PRNG so the tree and sky are identical on every load. */
export function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft elliptical glow centred on a point. */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: Rgb,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.5, rgba(color, alpha * 0.35));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

/** A long soft streak, optionally rotated. Wide (`rx`) by thin (`ry`). */
export function streak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: Rgb,
  alpha: number,
  rotation = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(rx / ry, 1);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.4, rgba(color, alpha * 0.3));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
  ctx.restore();
}

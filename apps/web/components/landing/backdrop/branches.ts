import {
  BLUE,
  CYAN,
  ICE,
  at,
  clamp,
  rgba,
  smoothstep,
  type Frame,
} from "./draw-kit";
import { GROW_SPAN, type TreeLine } from "./tree-geometry";

const ALPHA = [1, 0.8, 0.6] as const;
const WIDTH = [1.5, 1, 0.7] as const;

/**
 * Tree space to canvas pixels. Adds the slow sway, the ripple that travels
 * outward along each branch.
 */
export function projectPoint(
  f: Frame,
  x: number,
  y: number,
  phase: number,
  rootX: number,
  trunkWidth: number,
): [number, number] {
  const tx = x - rootX * (1 - trunkWidth);
  const reach = Math.hypot(tx, y);
  const sway =
    (Math.sin(f.time * 0.45 + phase + (tx + y) * 3) * 0.02 +
      Math.sin(f.time * 0.9 - reach * 6 + phase) * 0.008) *
    f.unit *
    Math.min(1, reach * 1.2);
  const sx = f.centerX + tx * f.unit + sway + f.parallaxX * 0.3;
  const sy =
    f.trunkTop - y * f.unit + Math.cos(f.time * 0.4 + phase) * sway * 0.3;
  return [sx, sy];
}

function strokeLine(
  f: Frame,
  line: TreeLine,
  points: readonly (readonly [number, number])[],
  fade: number,
): void {
  const { ctx } = f;
  const first = at(points, 0);
  const last = at(points, points.length - 1);
  const alpha =
    at(ALPHA, line.depth) *
    fade *
    (0.9 + 0.1 * Math.sin(f.time * 3 + line.phase));
  const width = at(WIDTH, line.depth);

  // The first stretch fades in from nothing so the branch seems to rise out of
  // the trunk's light instead of starting at a hard edge.
  const core = ctx.createLinearGradient(first[0], first[1], last[0], last[1]);
  core.addColorStop(0, rgba(ICE, 0));
  core.addColorStop(0.16, rgba(ICE, 0.95 * alpha));
  core.addColorStop(0.5, rgba(CYAN, 0.6 * alpha));
  core.addColorStop(1, rgba(BLUE, 0.15 * alpha));
  const halo = ctx.createLinearGradient(first[0], first[1], last[0], last[1]);
  halo.addColorStop(0, rgba(CYAN, 0));
  halo.addColorStop(0.2, rgba(CYAN, 0.2 * alpha));
  halo.addColorStop(1, rgba(BLUE, 0));

  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = at(points, i);
    const next = at(points, i + 1);
    ctx.quadraticCurveTo(
      p[0],
      p[1],
      (p[0] + next[0]) / 2,
      (p[1] + next[1]) / 2,
    );
  }
  ctx.lineTo(last[0], last[1]);
  ctx.strokeStyle = halo;
  ctx.lineWidth = width * 4.5;
  ctx.stroke();
  ctx.strokeStyle = core;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Draws every branch that has begun to grow. Returns, per line, how many of
 * its segments are out so the pulses know where each branch currently ends.
 */
export function drawBranches(
  f: Frame,
  lines: readonly TreeLine[],
  trunkWidth: number,
  grown: Float32Array,
): void {
  const fade = smoothstep(0, 0.12, f.growth);
  const maxDepth = f.lite ? 1 : 2;

  lines.forEach((line, index) => {
    grown[index] = 0;
    if (line.depth > maxDepth) return;
    const progress = clamp((f.growth - line.start) / GROW_SPAN);
    if (progress <= 0) return;

    const exact = progress * line.segments;
    const whole = Math.floor(exact);
    const fraction = exact - whole;
    const points: [number, number][] = [];
    for (let i = 0; i <= whole && i <= line.segments; i += 1) {
      let [x, y] = at(line.points, i);
      if (i === whole && whole < line.segments) {
        const next = at(line.points, whole + 1);
        x += (next[0] - x) * fraction;
        y += (next[1] - y) * fraction;
      }
      points.push(projectPoint(f, x, y, line.phase, line.rootX, trunkWidth));
    }
    grown[index] = exact;
    if (points.length > 1) strokeLine(f, line, points, fade);
  });
}

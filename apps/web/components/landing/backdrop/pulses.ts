import { projectPoint } from "./branches";
import {
  CYAN,
  ICE,
  at,
  glow,
  rgba,
  smoothstep,
  type Frame,
} from "./draw-kit";
import type { TreeLine } from "./tree-geometry";

const TRAIL_STEPS = [0, 0.7, 1.6, 2.8, 4.2] as const;

/** Position along a branch's trunk-to-tip route, as a projected canvas point. */
function routePosition(
  f: Frame,
  line: TreeLine,
  index: number,
  trunkWidth: number,
): [number, number] {
  const last = line.route.length - 1;
  const lower = Math.min(last, Math.max(0, Math.floor(index)));
  const upper = Math.min(last, lower + 1);
  const t = Math.min(1, Math.max(0, index - lower));
  const a = at(line.route, lower);
  const b = at(line.route, upper);
  return projectPoint(
    f,
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.phase,
    a.rootX,
    trunkWidth,
  );
}

/**
 * Pulses of light that run from each branch tip down through its parents and
 * into the trunk: the work of an agent or a teammate arriving at the shared
 * workspace. Each pulse stays inside the part of the branch that has grown.
 */
export function drawPulses(
  f: Frame,
  lines: readonly TreeLine[],
  grown: Float32Array,
  trunkWidth: number,
): void {
  const { ctx } = f;
  const fade = smoothstep(0, 0.12, f.growth);
  ctx.lineCap = "round";

  lines.forEach((line, index) => {
    const segments = grown[index] ?? 0;
    if (segments < 2 || line.pulses.length === 0) return;
    const tip = line.routeBase + segments;

    for (const pulse of line.pulses) {
      const travelled = (f.time * pulse.speed + pulse.phase) % 1;
      const strength = Math.sin(Math.PI * travelled) ** 0.6 * fade;
      if (strength < 0.03) continue;
      const head = tip * (1 - travelled);
      const trail = TRAIL_STEPS.map((step) =>
        routePosition(f, line, Math.min(tip, head + step), trunkWidth),
      );

      for (let i = 0; i < trail.length - 1; i += 1) {
        const from = at(trail, i);
        const to = at(trail, i + 1);
        const falloff = 1 - i / (trail.length - 1);
        ctx.strokeStyle = rgba(
          i === 0 ? ICE : CYAN,
          strength * falloff * 0.9,
        );
        ctx.lineWidth = (2.4 - line.depth * 0.5) * falloff + 0.6;
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
      }
      const front = at(trail, 0);
      glow(ctx, front[0], front[1], 7, 7, ICE, 0.45 * strength);
    }
  });
}

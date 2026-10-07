import { at, lerp, seeded, smoothstep } from "./draw-kit";

/** How much of the growth range one branch takes to extend to full length. */
export const GROW_SPAN = 0.55;

const SEGMENTS = [26, 17, 12] as const;
const PRIMARY_COUNT = 34;
const TRUNK_HALF_WIDTH = 0.055;

export type Depth = 0 | 1 | 2;

/** One vertex on the path from the trunk to a branch tip, through its parents. */
export interface RoutePoint {
  x: number;
  y: number;
  /** Phase of the branch that owns this vertex, so its sway stays consistent. */
  phase: number;
  rootX: number;
}

export interface Pulse {
  phase: number;
  speed: number;
}

export interface TreeLine {
  depth: Depth;
  /** Growth value at which this branch begins to extend. */
  start: number;
  segments: number;
  phase: number;
  /** Where the root branch leaves the trunk, so it can follow the trunk's width. */
  rootX: number;
  /** Own vertices, origin first, in tree units (x right, y up, 1 = `Frame.unit`). */
  points: readonly (readonly [number, number])[];
  /** Trunk-to-tip path including every ancestor branch, for pulses to follow. */
  route: readonly RoutePoint[];
  /** Index in `route` of this branch's first own vertex. */
  routeBase: number;
  pulses: readonly Pulse[];
}

interface Spawn {
  x: number;
  y: number;
  angle: number;
  length: number;
  depth: Depth;
  start: number;
  rootX: number;
  prefix: readonly RoutePoint[];
}

type Vertex = [number, number, number];

/** Walks one branch outward from its spawn point and returns its vertices. */
function trace(
  spawn: Spawn,
  rand: () => number,
): { vertices: Vertex[]; phase: number } {
  const { depth } = spawn;
  const segments = SEGMENTS[depth];
  const step = spawn.length / segments;
  const phase = rand() * 6.28;
  const wobble = rand() * 6.28;
  const drift = (rand() - 0.5) * 0.04;
  const bias = depth ? 0.03 : 0.04;
  const vertices: Vertex[] = [[spawn.x, spawn.y, 0]];
  let heading = depth === 0 ? 0 : spawn.angle;
  let x = spawn.x;
  let y = spawn.y;
  for (let j = 1; j <= segments; j += 1) {
    const u = j / segments;
    heading =
      depth === 0
        ? // Leave the trunk vertically, then curve outward.
          spawn.angle * smoothstep(0, 0.45, u) +
          Math.sin(j * 0.4 + wobble) * 0.05 * u
        : heading +
          drift * 0.5 +
          Math.sin(j * 0.4 + wobble) * (0.045 + depth * 0.05) -
          heading * bias * u;
    x += Math.sin(heading) * step;
    y += Math.cos(heading) * step;
    vertices.push([x, y, heading]);
  }
  return { vertices, phase };
}

function pulsesFor(depth: Depth, rand: () => number): Pulse[] {
  const count = depth === 0 ? 2 : depth === 1 ? 1 : rand() < 0.6 ? 1 : 0;
  return Array.from({ length: count }, () => ({
    phase: rand(),
    speed: 0.1 + rand() * 0.08,
  }));
}

/**
 * Builds the whole branch hierarchy once. Primary branches leave the trunk
 * vertically and curve outward; children fork off partway along and inherit
 * the route back to the trunk, which is what lets a pulse run from any twig,
 * down its parents, into the trunk.
 */
export function buildTree(seed = 33): TreeLine[] {
  const rand = seeded(seed);
  const lines: TreeLine[] = [];

  const grow = (spawn: Spawn): void => {
    const { depth } = spawn;
    const { vertices, phase } = trace(spawn, rand);
    const own = vertices.map(([x, y]) => ({ x, y, phase, rootX: spawn.rootX }));
    const route = depth === 0 ? own : [...spawn.prefix, ...own.slice(1)];
    const routeBase = depth === 0 ? 0 : spawn.prefix.length - 1;
    lines.push({
      depth,
      start: spawn.start,
      segments: SEGMENTS[depth],
      phase,
      rootX: spawn.rootX,
      points: vertices.map(([x, y]) => [x, y] as const),
      route,
      routeBase,
      pulses: pulsesFor(depth, rand),
    });

    if (depth === 2) return;
    const kids =
      depth === 0 ? 2 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
    for (let k = 0; k < kids; k += 1) {
      const attach = 5 + Math.floor(rand() * (SEGMENTS[depth] - 8));
      const from = at(vertices, attach);
      const remaining = 1 - attach / SEGMENTS[depth];
      grow({
        x: from[0],
        y: from[1],
        angle: from[2] + (rand() < 0.5 ? -1 : 1) * (0.22 + rand() * 0.32),
        length: spawn.length * (0.38 + rand() * 0.28) * (0.6 + remaining * 0.6),
        depth: (depth + 1) as Depth,
        start: spawn.start + (attach / SEGMENTS[depth]) * GROW_SPAN * 0.9,
        rootX: spawn.rootX,
        prefix: route.slice(0, routeBase + attach + 1),
      });
    }
  };

  for (let i = 0; i < PRIMARY_COUNT; i += 1) {
    const f = i / (PRIMARY_COUNT - 1);
    const angle = lerp(-1.5, 1.5, f) + (rand() - 0.5) * 0.1;
    const spread = Math.abs(angle) / 1.5;
    const rootX = (f * 2 - 1) * TRUNK_HALF_WIDTH;
    grow({
      x: rootX,
      y: -0.09,
      angle,
      length: lerp(0.55, 1.2, spread ** 1.05) * (0.85 + rand() * 0.3),
      depth: 0,
      start: rand() * 0.35,
      rootX,
      prefix: [],
    });
  }
  return lines;
}

import {
  LAVENDER,
  at,
  glow,
  lerp,
  rgba,
  seeded,
  type Frame,
  type Rgb,
} from "./draw-kit";

const LAYERS = 5;
const LAYER_SHAPES = Array.from({ length: LAYERS }, (_, i) => {
  const rand = seeded(100 + i);
  return {
    phaseA: rand() * 6.28,
    phaseB: rand() * 6.28,
    phaseC: rand() * 6.28,
  };
});
const GROUND_SHARE = 0.34;

export interface Mote {
  x: number;
  y: number;
  speed: number;
  phase: number;
}

export function createMotes(count: number, seed = 9): Mote[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    speed: 0.004 + rand() * 0.012,
    phase: rand() * 6.28,
  }));
}

/** Gentle windward slope, steep lee side: the profile of a real dune crest. */
function crest(angle: number): number {
  const turns = angle / (Math.PI * 2);
  const u = turns - Math.floor(turns);
  return u < 0.72
    ? Math.sin((u / 0.72) * (Math.PI / 2)) ** 1.6
    : Math.cos(((u - 0.72) / 0.28) * (Math.PI / 2)) ** 1.2;
}

interface Layer {
  depth: number;
  baseline: number;
  amplitude: number;
  height: (x: number) => number;
  lit: (x: number) => number;
}

function layerAt(f: Frame, index: number): Layer {
  const depth = index / (LAYERS - 1);
  const ground = f.height - f.horizon;
  const baseline = f.horizon + depth ** 1.3 * ground * 0.86 + ground * 0.03;
  const amplitude =
    (14 + depth * depth * 95) * (ground / (f.height * GROUND_SHARE));
  const frequency = 0.0105 / (0.4 + depth * 0.8);
  const shape = at(LAYER_SHAPES, index);
  const drift = f.time * 0.012 * (1 + depth);
  return {
    depth,
    baseline,
    amplitude,
    height: (x) =>
      baseline -
      amplitude *
        (crest(x * frequency + shape.phaseA + drift) * 0.65 +
          crest(x * frequency * 0.43 + shape.phaseB) * 0.35) +
      Math.sin(x * 0.004 + shape.phaseC) * amplitude * 0.25,
    lit: (x) =>
      0.14 +
      Math.exp(-(((x - f.centerX) / (f.width * (0.24 + depth * 0.2))) ** 2)),
  };
}

function across(
  f: Frame,
  color: Rgb,
  alpha: (x: number) => number,
): CanvasGradient {
  const gradient = f.ctx.createLinearGradient(0, 0, f.width, 0);
  for (let i = 0; i <= 10; i += 1)
    gradient.addColorStop(i / 10, rgba(color, alpha((f.width * i) / 10)));
  return gradient;
}

function tracePath(f: Frame, y: (x: number) => number, close: boolean): void {
  const { ctx } = f;
  ctx.beginPath();
  if (close) ctx.moveTo(-10, f.height + 10);
  for (let x = -10; x <= f.width + 10; x += 8) {
    if (!close && x === -10) ctx.moveTo(x, y(x));
    else ctx.lineTo(x, y(x));
  }
  if (close) {
    ctx.lineTo(f.width + 10, f.height + 10);
    ctx.closePath();
  }
}

/** Darkens the faces that turn away from the light at the horizon. */
function shadeLeeFaces(f: Frame, layer: Layer): void {
  const { ctx } = f;
  const shade = ctx.createLinearGradient(
    0,
    layer.baseline - layer.amplitude,
    0,
    layer.baseline + layer.amplitude,
  );
  shade.addColorStop(0, "rgba(2,4,22,.4)");
  shade.addColorStop(1, "rgba(2,4,22,.04)");
  ctx.fillStyle = shade;
  let run: [number, number, number][] = [];
  const flush = () => {
    if (run.length > 2) {
      ctx.beginPath();
      run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = run.length - 1; i >= 0; i -= 1) {
        const [x, y, slope] = at(run, i);
        ctx.lineTo(
          x,
          y + (6 + layer.amplitude * 0.3) * Math.min(1, Math.abs(slope) / 6),
        );
      }
      ctx.closePath();
      ctx.fill();
    }
    run = [];
  };
  for (let x = 0; x <= f.width + 8; x += 8) {
    const y = layer.height(x);
    const slope = y - layer.height(x - 8);
    if (slope * (x - f.centerX) > 0) run.push([x, y, slope]);
    else flush();
  }
  flush();
}

function drawRipples(f: Frame, layer: Layer, light: number): void {
  const { ctx } = f;
  const count = f.lite
    ? 3 + Math.round(layer.depth * 4)
    : 4 + Math.round(layer.depth * 11);
  for (let r = 1; r <= count; r += 1) {
    const offset = r * (2.2 + layer.depth * 5.5);
    ctx.strokeStyle = across(f, [150, 170, 255], (x) =>
      Math.min(0.5, 0.32 * light * layer.lit(x) * (1 - r / (count + 2))),
    );
    ctx.lineWidth = 0.6 + layer.depth * 0.5;
    tracePath(
      f,
      (x) =>
        layer.height(x) +
        offset +
        Math.sin(x * 0.07 + r * 1.3 + f.time * 0.1) * (0.6 + layer.depth * 1.6),
      false,
    );
    ctx.stroke();
  }
}

function drawLayer(f: Frame, index: number, light: number): void {
  const { ctx } = f;
  const layer = layerAt(f, index);
  const top: [number, number, number] = [
    lerp(75, 16, layer.depth),
    lerp(105, 28, layer.depth),
    lerp(215, 100, layer.depth),
  ];
  ctx.globalCompositeOperation = "source-over";
  tracePath(f, layer.height, true);
  const body = ctx.createLinearGradient(
    0,
    layer.baseline - layer.amplitude,
    0,
    f.height,
  );
  body.addColorStop(0, rgba(top, 1));
  body.addColorStop(1, "#03061c");
  ctx.fillStyle = body;
  ctx.fill();
  shadeLeeFaces(f, layer);

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = across(
    f,
    LAVENDER,
    (x) => 0.4 * light * layer.lit(x) * (1 - layer.depth * 0.35),
  );
  tracePath(f, layer.height, true);
  ctx.fill();
  ctx.strokeStyle = across(
    f,
    [200, 220, 255],
    (x) => 0.75 * light * layer.lit(x) * (1 - layer.depth * 0.4),
  );
  ctx.lineWidth = 1 + layer.depth;
  tracePath(f, layer.height, false);
  ctx.stroke();
  drawRipples(f, layer, light);
  if (index === 1)
    glow(
      ctx,
      f.centerX,
      f.horizon + f.height * 0.02,
      f.width * 0.6,
      f.height * 0.05,
      [110, 150, 255],
      0.2 + 0.15 * f.reveal,
    );
}

export function drawDunes(f: Frame, motes: readonly Mote[]): void {
  const light = 0.55 + 0.6 * f.reveal;
  for (let i = 0; i < LAYERS; i += 1) drawLayer(f, i, light);

  if (f.lite) return;
  const { ctx } = f;
  const ground = f.height - f.horizon;
  for (const mote of motes) {
    const x = ((mote.x + f.time * mote.speed) % 1) * f.width;
    const y =
      f.horizon +
      f.height * 0.03 +
      mote.y * ground * 0.9 +
      Math.sin(f.time * 0.5 + mote.phase) * 3;
    ctx.fillStyle = rgba(
      [180, 200, 255],
      0.25 * Math.exp(-(((x - f.centerX) / (f.width * 0.4)) ** 2)),
    );
    ctx.fillRect(x, y, 1.4, 1.4);
  }
}

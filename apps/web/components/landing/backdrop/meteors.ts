import { clamp, glow, lerp, rgba, type Frame, type Rgb } from "./draw-kit";
import { duneSurfaceY } from "./dunes";

const EMBER: Rgb = [255, 105, 46];
const GOLD: Rgb = [255, 211, 136];
const IMPACT = 1.2;
const METEORS_PER_SECOND = 0.5;
const START_DELAY = 1.2;
const METEORS = [
  { layer: 1, scale: 0.45, flight: 2.2, brightness: 0.3 },
  { layer: 4, scale: 1.3, flight: 1.45, brightness: 1 },
  { layer: 2, scale: 0.75, flight: 1.9, brightness: 0.6 },
] as const;
type Meteor = (typeof METEORS)[number];

function falling(
  f: Frame,
  x: number,
  y: number,
  direction: number,
  age: number,
  meteor: Meteor,
) {
  const progress = clamp(age / meteor.flight);
  const startX = x - direction * f.width * 0.23;
  const headX = lerp(startX, x, progress);
  const headY = lerp(-40, y, progress);
  const tail = Math.max(0, progress - 0.17 * meteor.scale);
  const tailX = lerp(startX, x, tail);
  const tailY = lerp(-40, y, tail);
  const { ctx } = f;
  const trail = ctx.createLinearGradient(tailX, tailY, headX, headY);
  trail.addColorStop(0, rgba(EMBER, 0));
  trail.addColorStop(0.65, rgba(EMBER, 0.8));
  trail.addColorStop(1, rgba(GOLD, 1));
  ctx.strokeStyle = trail;
  ctx.lineWidth = 3 * meteor.scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tailX, tailY);
  ctx.lineTo(headX, headY);
  ctx.stroke();
  glow(ctx, headX, headY, 18 * meteor.scale, 18 * meteor.scale, EMBER, 0.65);
  glow(ctx, headX, headY, 4 * meteor.scale, 4 * meteor.scale, GOLD, 1);
}

function impact(f: Frame, x: number, y: number, age: number, meteor: Meteor) {
  const fade = (1 - clamp(age / IMPACT)) ** 2;
  const { ctx } = f;
  const { scale, layer } = meteor;
  glow(
    ctx,
    x,
    y,
    (35 + age * 65) * scale,
    (10 + age * 14) * scale,
    EMBER,
    fade * 0.75,
  );
  ctx.strokeStyle = rgba(EMBER, fade * 0.7);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    (4 + age * 55) * scale,
    (2 + age * 12) * scale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  const count = f.lite ? 6 : 12;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.PI + (i / (count - 1)) * Math.PI;
    const speed = (35 + (i % 4) * 18) * scale;
    const sx = x + Math.cos(angle) * speed * age;
    const sy = y + Math.sin(angle) * speed * age + 65 * age * age * scale;
    if (sy > duneSurfaceY(f, sx, layer) + 3) continue;
    ctx.fillStyle = rgba(i % 2 ? GOLD : EMBER, fade);
    ctx.fillRect(sx, sy, 2 * scale, 2 * scale);
  }
}

/** Foreground dune crests hide the distant streaks and their impacts. */
function occludeBehindDunes(f: Frame, layer: number) {
  if (layer === 4) return;
  const { ctx } = f;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(f.width, 0);
  for (let x = f.width; x >= 0; x -= 8) {
    const front = Array.from({ length: 4 - layer }, (_, i) =>
      duneSurfaceY(f, x, layer + 1 + i),
    );
    ctx.lineTo(x, Math.min(...front));
  }
  ctx.closePath();
  ctx.clip();
}

function drawMeteor(f: Frame, meteor: Meteor, index: number) {
  const { flight, layer } = meteor;
  const age = f.time - START_DELAY - index / METEORS_PER_SECOND;
  if (age < 0 || age > flight + IMPACT) return;
  // The golden-ratio sequence spreads successive landings across the sand.
  const x = f.width * (0.08 + ((index * 0.61803398875) % 1) * 0.84);
  const y = duneSurfaceY({ ...f, time: f.time - age + flight }, x, layer);
  if (age < flight) falling(f, x, y, index % 2 ? -1 : 1, age, meteor);
  else impact(f, x, y, age - flight, meteor);
}

/** One launch every two seconds; only live streaks and impacts are rendered. */
export function drawMeteors(f: Frame): void {
  const elapsed = f.time - START_DELAY;
  if (elapsed < 0) return;
  const newest = Math.floor(elapsed * METEORS_PER_SECOND);
  const oldest = Math.max(
    0,
    Math.ceil((elapsed - 2.2 - IMPACT) * METEORS_PER_SECOND),
  );
  const { ctx } = f;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  METEORS.forEach((meteor, profile) => {
    ctx.save();
    ctx.globalAlpha = meteor.brightness;
    // Share the dune clip across all meteors at the same distance.
    occludeBehindDunes(f, meteor.layer);
    for (let index = oldest; index <= newest; index += 1) {
      if (index % METEORS.length === profile) drawMeteor(f, meteor, index);
    }
    ctx.restore();
  });
  ctx.restore();
}

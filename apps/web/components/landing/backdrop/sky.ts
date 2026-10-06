import {
  BLUE,
  CYAN,
  ICE,
  TEAL,
  VIOLET,
  glow,
  lerp,
  rgba,
  seeded,
  smoothstep,
  streak,
  type Frame,
  type Rgb,
} from "./draw-kit";

interface Star {
  x: number;
  y: number;
  radius: number;
  phase: number;
  speed: number;
  bright: boolean;
}

interface Cloud {
  x: number;
  y: number;
  size: number;
  color: Rgb;
  alpha: number;
}

interface Wisp {
  x: number;
  y: number;
  length: number;
  angle: number;
  width: number;
  color: Rgb;
  alpha: number;
  phase: number;
}

export interface Sky {
  stars: readonly Star[];
  clouds: readonly Cloud[];
  wisps: readonly Wisp[];
}

const CLOUDS: readonly Cloud[] = [
  { x: 0.15, y: 0.25, size: 0.5, color: VIOLET, alpha: 0.17 },
  { x: 0.85, y: 0.2, size: 0.55, color: BLUE, alpha: 0.12 },
  { x: 0.5, y: 0.1, size: 0.55, color: BLUE, alpha: 0.16 },
  { x: 0.3, y: 0.5, size: 0.4, color: CYAN, alpha: 0.07 },
  { x: 0.75, y: 0.45, size: 0.4, color: VIOLET, alpha: 0.135 },
  { x: 0.06, y: 0.5, size: 0.3, color: BLUE, alpha: 0.15 },
  { x: 0.95, y: 0.5, size: 0.3, color: VIOLET, alpha: 0.135 },
  { x: 0.35, y: 0.32, size: 0.35, color: TEAL, alpha: 0.09 },
  { x: 0.8, y: 0.32, size: 0.3, color: TEAL, alpha: 0.075 },
];

export function createSky(starCount: number, seed = 5): Sky {
  const rand = seeded(seed);
  const palette = [VIOLET, BLUE, TEAL] as const;
  return {
    clouds: CLOUDS,
    stars: Array.from({ length: starCount }, () => ({
      x: rand(),
      y: rand() ** 0.85,
      radius: 0.4 + rand() * rand() * 1.7,
      phase: rand() * 6.28,
      speed: 0.4 + rand() * 1.6,
      bright: rand() < 0.04,
    })),
    wisps: Array.from({ length: 9 }, () => ({
      x: 0.55 + rand() * 0.5,
      y: 0.1 + rand() * 0.5,
      length: 0.15 + rand() * 0.25,
      angle: -0.7 + rand() * 0.3,
      width: 0.015 + rand() * 0.03,
      color: palette[Math.floor(rand() * 3)] ?? BLUE,
      alpha: 0.12 + rand() * 0.12,
      phase: rand() * 6.28,
    })),
  };
}

function drawStar(f: Frame, star: Star, x: number, y: number): void {
  const { ctx } = f;
  const twinkle = 0.55 + 0.45 * Math.sin(f.time * star.speed + star.phase);
  const nearHorizon = Math.min(1, (f.horizon - y) / (f.horizon * 0.3) + 0.35);
  const alpha = (star.bright ? 0.95 : 0.55) * twinkle * nearHorizon;
  ctx.fillStyle = rgba(star.bright ? ICE : [190, 215, 255], alpha);
  ctx.beginPath();
  ctx.arc(x, y, star.radius, 0, Math.PI * 2);
  ctx.fill();
  if (!star.bright) return;
  glow(
    ctx,
    x,
    y,
    11 + star.radius * 5,
    11 + star.radius * 5,
    CYAN,
    0.3 * twinkle,
  );
  const arm = 3 + 8 * twinkle;
  ctx.strokeStyle = rgba(ICE, 0.45 * twinkle);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.stroke();
}

export function drawSky(f: Frame, sky: Sky): void {
  const { ctx, width, horizon, time } = f;
  const gradient = ctx.createLinearGradient(0, 0, 0, horizon);
  gradient.addColorStop(0, "#01020a");
  gradient.addColorStop(0.45, "#02061c");
  gradient.addColorStop(0.8, "#07134a");
  gradient.addColorStop(1, "#112a78");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, f.height);
  ctx.globalCompositeOperation = "lighter";

  const lift = 0.8 + 0.5 * f.bloom;
  sky.clouds.forEach((cloud, i) => {
    const x =
      cloud.x * width +
      Math.sin(time * 0.05 + i * 1.3) * width * 0.03 +
      f.parallaxX * 1.5;
    const y =
      cloud.y * horizon +
      Math.cos(time * 0.04 + i) * horizon * 0.03 +
      f.parallaxY * 1.5;
    const pulse = 0.85 + 0.15 * Math.sin(time * 0.2 + i);
    glow(
      ctx,
      x,
      y,
      cloud.size * width * 0.55,
      cloud.size * horizon * 0.6,
      cloud.color,
      cloud.alpha * 1.7 * pulse * lift,
    );
  });
  for (const wisp of sky.wisps) {
    const x =
      wisp.x * width + Math.sin(time * 0.06 + wisp.phase) * 20 + f.parallaxX;
    const shimmer = 0.7 + 0.4 * Math.sin(time * 0.25 + wisp.phase);
    streak(
      ctx,
      x,
      wisp.y * horizon + f.parallaxY,
      wisp.length * width,
      wisp.width * width,
      wisp.color,
      wisp.alpha * 0.8 * shimmer,
      wisp.angle,
    );
  }

  const spin = time * 0.0035;
  for (const [index, star] of sky.stars.entries()) {
    if (f.lite && index % 2) continue;
    const dx = star.x * width - f.centerX;
    const dy = star.y * horizon * 0.98 - horizon;
    const x =
      f.centerX + dx * Math.cos(spin) - dy * Math.sin(spin) + f.parallaxX * 0.6;
    const y =
      horizon + dx * Math.sin(spin) + dy * Math.cos(spin) + f.parallaxY * 0.6;
    if (y < horizon - 2 && x > 0 && x < width) drawStar(f, star, x, y);
  }
}

/** The thin pillar of light that is all there is before the tree grows. */
export function drawPillar(f: Frame): void {
  const { ctx } = f;
  const flicker =
    1 + 0.06 * Math.sin(f.time * 1.7) + 0.03 * Math.sin(f.time * 3.1);
  const strength = (1 - f.reveal * 0.7) * flicker;
  streak(
    ctx,
    f.centerX,
    f.horizon - f.height * 0.3,
    f.width * 0.012,
    f.height * 0.7,
    CYAN,
    0.5 * strength,
  );
  streak(
    ctx,
    f.centerX,
    f.horizon - f.height * 0.2,
    f.width * 0.003,
    f.height * 0.6,
    ICE,
    0.8 * strength,
  );
  glow(
    ctx,
    f.centerX,
    f.horizon,
    f.width * 0.5,
    f.height * 0.07,
    [150, 185, 255],
    lerp(0.3, 0.5, f.reveal),
  );
  glow(
    ctx,
    f.centerX,
    f.horizon,
    f.width * 0.85,
    f.height * 0.17,
    BLUE,
    lerp(0.2, 0.3, f.reveal),
  );
}

/** Energy arcs that sweep around the canopy once it is fully out. */
export function drawSwirls(f: Frame): void {
  if (f.bloom < 0.02 || f.lite) return;
  const { ctx } = f;
  const centerY = f.horizon - f.height * 0.2;
  for (let i = 0; i < 12; i += 1) {
    const side = i % 2 ? 1 : -1;
    const radiusX = f.width * (0.36 + (i % 5) * 0.045);
    const radiusY = f.height * (0.2 + (i % 4) * 0.07);
    const span = 0.3 + (i % 3) * 0.12;
    const start =
      (side > 0 ? -0.45 : Math.PI - 0.25) +
      side * -0.04 * i +
      Math.sin(f.time * 0.12 + i) * 0.05;
    ctx.beginPath();
    for (let k = 0; k <= 26; k += 1) {
      const angle = start + side * (k / 26) * span;
      const x = f.centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY * 1.1;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1 + (i % 3) * 0.5;
    ctx.strokeStyle = rgba(
      i % 3 === 0 ? ICE : CYAN,
      0.38 * smoothstep(0.02, 1, f.bloom),
    );
    ctx.stroke();
  }
}

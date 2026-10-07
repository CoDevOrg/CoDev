import { CYAN, ICE, glow, lerp, rgba, type Frame } from "./draw-kit";

/** Width of the trunk, 0.3 (just a pillar) to 1 (full), shared with the branches. */
export function trunkWidth(f: Frame): number {
  return lerp(0.3, 1, f.reveal);
}

/** Paints the trunk body into a scratch canvas so its top can fade to nothing. */
function paintBody(
  f: Frame,
  scratch: HTMLCanvasElement,
  pixelRatio: number,
  half: { base: number; top: number },
  brightness: number,
): void {
  const q = scratch.getContext("2d");
  if (!q) return;
  q.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  q.globalCompositeOperation = "source-over";
  q.clearRect(0, 0, f.width, f.height);
  const top = f.trunkTop - 40;
  const across = q.createLinearGradient(
    f.centerX - half.base,
    0,
    f.centerX + half.base,
    0,
  );
  across.addColorStop(0, rgba(CYAN, 0));
  across.addColorStop(0.28, rgba(CYAN, 0.28 * brightness));
  across.addColorStop(0.5, rgba(ICE, 0.9 * brightness));
  across.addColorStop(0.72, rgba(CYAN, 0.28 * brightness));
  across.addColorStop(1, rgba(CYAN, 0));
  q.fillStyle = across;
  q.beginPath();
  q.moveTo(f.centerX - half.base * 1.6, f.horizon);
  q.lineTo(f.centerX + half.base * 1.6, f.horizon);
  q.lineTo(f.centerX + half.top, top);
  q.lineTo(f.centerX - half.top, top);
  q.closePath();
  q.fill();
  q.globalCompositeOperation = "destination-in";
  const fade = q.createLinearGradient(0, f.horizon, 0, top);
  fade.addColorStop(0, "#000");
  fade.addColorStop(0.62, "#000");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  q.fillStyle = fade;
  q.fillRect(0, 0, f.width, f.height);
}

function drawFibers(
  f: Frame,
  half: { base: number; top: number },
  brightness: number,
): void {
  const { ctx } = f;
  const span = f.trunkTop - f.horizon;
  for (let i = 0; i < 24; i += 1) {
    const side = (i / 23) * 2 - 1;
    ctx.beginPath();
    for (let j = 0; j <= 14; j += 1) {
      const u = j / 14;
      const spread = lerp(half.base, half.top, u);
      const x =
        f.centerX +
        side * spread * 1.05 +
        Math.sin(f.time * 0.9 + i * 1.9 + u * 6) * f.width * 0.002 * u;
      const y = f.horizon + span * u;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(ICE, 0.35 * brightness * (1 - Math.abs(side) * 0.5));
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function drawTrunk(
  f: Frame,
  scratch: HTMLCanvasElement,
  pixelRatio: number,
): void {
  const { ctx } = f;
  const width = trunkWidth(f);
  const brightness = 0.25 + 0.75 * f.reveal;
  const half = { base: f.width * 0.062 * width, top: f.width * 0.03 * width };
  const flicker =
    1 + 0.06 * Math.sin(f.time * 1.7) + 0.03 * Math.sin(f.time * 3.1);

  if (
    scratch.width !== Math.round(f.width * pixelRatio) ||
    scratch.height !== Math.round(f.height * pixelRatio)
  ) {
    scratch.width = Math.round(f.width * pixelRatio);
    scratch.height = Math.round(f.height * pixelRatio);
  }
  paintBody(f, scratch, pixelRatio, half, brightness * flicker);
  ctx.drawImage(scratch, 0, 0, f.width, f.height);
  drawFibers(f, half, brightness);

  const height = f.horizon - f.trunkTop;
  glow(
    ctx,
    f.centerX,
    f.horizon,
    f.width * 0.16 * width + f.width * 0.04,
    f.height * 0.06,
    ICE,
    0.5 * brightness,
  );
  glow(
    ctx,
    f.centerX,
    f.trunkTop,
    f.width * 0.2,
    f.height * 0.16,
    CYAN,
    0.25 * f.reveal * flicker,
  );
  glow(
    ctx,
    f.centerX,
    f.trunkTop + height * 0.5,
    f.width * 0.1,
    f.height * 0.2,
    CYAN,
    0.15 * f.reveal,
  );
  glow(
    ctx,
    f.centerX,
    f.trunkTop,
    f.width * 0.09,
    f.height * 0.09,
    ICE,
    0.5 * f.reveal * flicker,
  );

  if (f.lite) return;
  for (let i = 0; i < 5; i += 1) {
    const u = (f.time * 0.16 + i / 5) % 1;
    ctx.fillStyle = rgba(ICE, 0.7 * brightness * Math.sin(Math.PI * u));
    ctx.beginPath();
    ctx.arc(
      f.centerX + Math.sin(f.time + i * 2) * half.base * 0.35,
      f.trunkTop + height * u,
      1.8,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

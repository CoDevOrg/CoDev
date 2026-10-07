import { drawBranches } from "./branches";
import { createMotes, drawDunes } from "./dunes";
import { MAX_GROWTH, clamp, smoothstep, type Frame } from "./draw-kit";
import { drawPulses } from "./pulses";
import { drawMeteors } from "./meteors";
import { createSky, drawPillar, drawSky, drawSwirls } from "./sky";
import { buildTree } from "./tree-geometry";
import { drawTrunk, trunkWidth } from "./trunk";

export interface LandingSceneOptions {
  canvas: HTMLCanvasElement;
  meteorCanvas?: HTMLCanvasElement | undefined;
  pixelRatio: number;
  /** Fewer stars, branches and pulses, for small or slow screens. */
  lite: boolean;
}

export interface LandingScene {
  resize(width: number, height: number, pixelRatio: number): void;
  /** `progress` is scroll progress 0..1; `pointer` is in canvas CSS pixels. */
  render(
    elapsedSeconds: number,
    progress: number,
    pointer: { x: number; y: number } | null,
  ): void;
  setLite(lite: boolean): void;
  dispose(): void;
}

/**
 * The landing hero: a night sky over rippled dunes with a glowing tree whose
 * branches (people and agents) grow outward and fork as the reader scrolls,
 * while pulses of light run from the tips down into the trunk, the shared
 * workspace. Plain Canvas 2D so it needs no GPU context and no extra bundle.
 *
 * Returns null when a 2D context cannot be acquired, so the caller keeps the
 * static still without logging anything.
 */
export function createLandingScene(
  options: LandingSceneOptions,
): LandingScene | null {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) return null;
  const meteorCtx = options.meteorCanvas?.getContext("2d");

  const tree = buildTree();
  const grown = new Float32Array(tree.length);
  const sky = createSky(560);
  const motes = createMotes(80);
  const trunkScratch = document.createElement("canvas");
  let pixelRatio = options.pixelRatio;
  let lite = options.lite;
  let width = 0;
  let height = 0;

  return {
    resize(nextWidth, nextHeight, nextPixelRatio) {
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextPixelRatio;
      options.canvas.width = Math.round(width * pixelRatio);
      options.canvas.height = Math.round(height * pixelRatio);
      if (options.meteorCanvas) {
        options.meteorCanvas.width = options.canvas.width;
        options.meteorCanvas.height = options.canvas.height;
      }
    },

    render(elapsedSeconds, progress, pointer) {
      if (width === 0 || height === 0) return;
      const ambientGrowth = 0.55 + Math.sin(elapsedSeconds * 0.18) * 0.04;
      const growth = Math.max(ambientGrowth, clamp(progress)) * MAX_GROWTH;
      const horizon = height * 0.8;
      const f: Frame = {
        ctx,
        width,
        height,
        time: elapsedSeconds,
        growth,
        reveal: clamp(growth),
        bloom: smoothstep(0.5, MAX_GROWTH, growth),
        centerX: width / 2,
        horizon,
        trunkTop: horizon - height * 0.24,
        unit: height * 0.98,
        parallaxX: pointer ? -(pointer.x / width - 0.5) * 14 : 0,
        parallaxY: pointer ? -(pointer.y / height - 0.5) * 8 : 0,
        lite,
      };
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawSky(f, sky);
      drawPillar(f);
      drawSwirls(f);
      drawTrunk(f, trunkScratch, pixelRatio);
      drawBranches(f, tree, trunkWidth(f), grown);
      drawPulses(f, tree, grown, trunkWidth(f));
      drawDunes(f, motes);
      if (meteorCtx) {
        meteorCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        meteorCtx.clearRect(0, 0, width, height);
        drawMeteors({ ...f, ctx: meteorCtx });
      }
      ctx.globalCompositeOperation = "source-over";
    },

    setLite(next) {
      lite = next;
    },

    dispose() {
      trunkScratch.width = 0;
      trunkScratch.height = 0;
    },
  };
}

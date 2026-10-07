import { afterEach, describe, expect, it, vi } from "vitest";

import { createLandingScene } from "./landing-scene";

/**
 * jsdom has no canvas, so the 2D context is a recording stub: every drawing
 * method is a no-op and every gradient accepts colour stops. That is enough to
 * run each layer for real and catch a thrown error or a NaN reaching the API.
 */
function fakeContext() {
  const calls = new Map<string, number>();
  const gradient = { addColorStop: vi.fn() };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_, key: string) {
      if (key === "createLinearGradient" || key === "createRadialGradient")
        return () => gradient;
      return (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        for (const arg of args) {
          if (typeof arg === "number" && Number.isNaN(arg)) {
            throw new Error(`NaN passed to ${key}`);
          }
        }
      };
    },
    set() {
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** Stubs every canvas, including the trunk's scratch canvas the scene makes itself. */
function canvasWith(ctx: CanvasRenderingContext2D | null) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as never,
  );
  return document.createElement("canvas");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLandingScene", () => {
  it("returns null without a 2D context so the still stays put", () => {
    const scene = createLandingScene({
      canvas: canvasWith(null),
      pixelRatio: 1,
      lite: false,
    });
    expect(scene).toBeNull();
  });

  it("draws every stage of growth without producing NaN", () => {
    const { ctx, calls } = fakeContext();
    const canvas = canvasWith(ctx);
    const meteorCanvas = document.createElement("canvas");
    const scene = createLandingScene({
      canvas,
      meteorCanvas,
      pixelRatio: 2,
      lite: false,
    });
    expect(scene).not.toBeNull();
    scene?.resize(1280, 720, 2);

    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      scene?.render(3.2, progress, { x: 640, y: 300 });
    }
    scene?.render(3.2, 1, null);
    // Cover flight, sand impact, and a later cycle on the warm overlay.
    for (const time of [0, 1.8, 3.6, 6.2, 15.6]) scene?.render(time, 0, null);
    expect(canvas.width).toBe(2560);
    expect(meteorCanvas.width).toBe(2560);
    expect(calls.get("clearRect")).toBeGreaterThan(0);
    // Branches and pulses are strokes; a grown tree draws many of them.
    expect(calls.get("stroke") ?? 0).toBeGreaterThan(500);
  });

  it("draws fewer branches in the lite tier", () => {
    const full = fakeContext();
    const lite = fakeContext();
    const a = createLandingScene({
      canvas: canvasWith(full.ctx),
      pixelRatio: 1,
      lite: false,
    });
    const b = createLandingScene({
      canvas: canvasWith(lite.ctx),
      pixelRatio: 1,
      lite: true,
    });
    a?.resize(1280, 720, 1);
    b?.resize(1280, 720, 1);
    a?.render(5, 1, null);
    b?.render(5, 1, null);
    expect(lite.calls.get("stroke") ?? 0).toBeLessThan(
      full.calls.get("stroke") ?? 0,
    );
  });

  it("does nothing before it has a size", () => {
    const { ctx, calls } = fakeContext();
    const scene = createLandingScene({
      canvas: canvasWith(ctx),
      pixelRatio: 1,
      lite: false,
    });
    scene?.render(1, 0.5, null);
    expect(calls.size).toBe(0);
  });
});

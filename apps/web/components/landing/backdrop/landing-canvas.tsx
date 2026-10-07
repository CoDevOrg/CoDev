"use client";

import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "./motion-preference";
import type { LandingScene } from "./landing-scene";

const MOBILE_BREAKPOINT = 720;
const SMOOTHING = 0.08;
const SLOW_FRAME_MS = 28;
const UNUSABLE_FRAME_MS = 45;
const SAMPLE_FRAMES = 90;
/** The tree is fully grown once the reader is this far down the page. */
const FULL_GROWTH_AT = 0.7;

function scrollProgress(): number {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return 0;
  return Math.min(
    1,
    Math.max(0, window.scrollY / (scrollable * FULL_GROWTH_AT)),
  );
}

/**
 * The animated landing backdrop, fixed behind the whole page.
 *
 * Default export so `next/dynamic` can load it, following the one existing
 * precedent for a browser-only module in this app
 * (`components/gen2/editor-pane.tsx`).
 *
 * Everything here is progressive enhancement over the static still underneath:
 * a reader with reduced motion, without JavaScript, or on a machine too slow to
 * keep up keeps a complete page. The scene module is imported inside the
 * effect after the motion gate passes, so those readers never download it.
 */
export default function LandingCanvas() {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meteorRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const layer = layerRef.current;
    const canvas = canvasRef.current;
    if (!layer || !canvas) return;

    const root: HTMLDivElement = layer;
    const surface: HTMLCanvasElement = canvas;
    let scene: LandingScene | null = null;
    let frame = 0;
    let disposed = false;
    let pageVisible = document.visibilityState !== "hidden";
    let onScreen = true;
    let smoothed = scrollProgress();
    let target = smoothed;
    let pointer: { x: number; y: number } | null = null;
    let lite = window.innerWidth <= MOBILE_BREAKPOINT;
    let lastFrameAt = 0;
    const pacing = { frames: 0, total: 0, done: false };
    const started = performance.now();

    const pixelRatio = () =>
      Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2);

    function resize() {
      scene?.resize(root.clientWidth, root.clientHeight, pixelRatio());
    }

    function onScroll() {
      target = scrollProgress();
    }

    function onPointerMove(event: PointerEvent) {
      const rect = surface.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function onPointerLeave() {
      pointer = null;
    }

    function onVisibility() {
      pageVisible = document.visibilityState !== "hidden";
      lastFrameAt = 0;
      schedule();
    }

    function stop() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    /**
     * Reads the first stretch of frame times. A slow machine first drops to the
     * lighter scene; if even that cannot keep up, the still takes over again.
     */
    function watchFramePacing(now: number) {
      if (pacing.done) return;
      if (lastFrameAt > 0) {
        pacing.total += now - lastFrameAt;
        pacing.frames += 1;
      }
      lastFrameAt = now;
      if (pacing.frames < SAMPLE_FRAMES) return;

      const average = pacing.total / pacing.frames;
      pacing.frames = 0;
      pacing.total = 0;
      if (average > UNUSABLE_FRAME_MS && lite) {
        stop();
        disposed = true;
        setActive(false);
      } else if (average > SLOW_FRAME_MS && !lite) {
        lite = true;
        scene?.setLite(true);
        resize();
      } else {
        pacing.done = true;
      }
    }

    function schedule() {
      if (disposed || frame || !pageVisible || !onScreen) return;
      frame = window.requestAnimationFrame(tick);
    }

    function tick(now: number) {
      frame = 0;
      if (disposed || !scene) return;
      smoothed += (target - smoothed) * SMOOTHING;
      scene.render((performance.now() - started) / 1000, smoothed, pointer);
      watchFramePacing(now);
      schedule();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        onScreen = entry ? entry.isIntersecting : true;
        if (onScreen) {
          lastFrameAt = 0;
          schedule();
        } else stop();
      },
      { threshold: 0 },
    );
    const resizeObserver = new ResizeObserver(() => {
      resize();
      onScroll();
    });

    void (async () => {
      const { createLandingScene } = await import("./landing-scene");
      if (disposed) return;

      scene = createLandingScene({
        canvas: surface,
        meteorCanvas: meteorRef.current ?? undefined,
        pixelRatio: pixelRatio(),
        lite,
      });
      if (!scene) return;

      resize();
      setActive(true);

      window.addEventListener("resize", resize, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      document.addEventListener("visibilitychange", onVisibility);
      observer.observe(surface);
      resizeObserver.observe(root);

      schedule();
    })();

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      scene?.dispose();
      scene = null;
    };
  }, []);

  // The static still is server-rendered in `app/page.tsx` rather than here, so
  // it is on screen before this bundle loads and stays for a reader with no
  // JavaScript at all. `landing.css` cross-fades it out via `:has()` once this
  // layer reports `data-canvas="on"`.
  return (
    <div
      ref={layerRef}
      className="lp-canvas-layer"
      data-canvas={active ? "on" : "off"}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="lp-canvas" />
      <canvas ref={meteorRef} className="lp-meteor-canvas" />
    </div>
  );
}

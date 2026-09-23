"use client";

import { useEffect, useRef, useState } from "react";

import type { LandingScene } from "./scene";
import { prefersReducedMotion, supportsWebGL } from "./webgl-support";

const DESKTOP_PARTICLES = 6000;
const MOBILE_PARTICLES = 2200;
const MOBILE_BREAKPOINT = 720;
const SMOOTHING = 0.08;

function scrollProgress(): number {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / scrollable));
}

/**
 * The animated landing backdrop.
 *
 * Default export so `next/dynamic` can load it, following the one existing
 * precedent for a browser-only library in this app
 * (`components/gen2/editor-pane.tsx`).
 *
 * Everything here is progressive enhancement over the static still underneath:
 * a reader with reduced motion, without WebGL, or without JavaScript keeps a
 * complete page. three.js is imported inside the effect *after* the gates
 * pass, so those readers never download it.
 */
export default function LandingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion() || !supportsWebGL()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: LandingScene | null = null;
    let frame = 0;
    let disposed = false;
    let pageVisible = document.visibilityState !== "hidden";
    let onScreen = true;
    let smoothed = scrollProgress();
    let target = smoothed;
    let pointerX = 0;
    let pointerY = 0;
    const started = performance.now();

    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      scene?.resize(window.innerWidth, window.innerHeight, pixelRatio());
    }

    function onScroll() {
      target = scrollProgress();
    }

    function onPointerMove(event: PointerEvent) {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    }

    function onVisibility() {
      pageVisible = document.visibilityState !== "hidden";
      schedule();
    }

    function onContextLost(event: Event) {
      // Without preventDefault the context can never be restored, and the
      // browser logs to the console. The e2e suite fails on console errors,
      // so drop to the still instead.
      event.preventDefault();
      stop();
      setActive(false);
    }

    function stop() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    function schedule() {
      if (disposed || frame || !pageVisible || !onScreen) return;
      frame = window.requestAnimationFrame(tick);
    }

    function tick() {
      frame = 0;
      if (disposed || !scene) return;
      smoothed += (target - smoothed) * SMOOTHING;
      scene.render(
        (performance.now() - started) / 1000,
        smoothed,
        pointerX,
        pointerY,
      );
      schedule();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        onScreen = entry ? entry.isIntersecting : true;
        if (onScreen) schedule();
        else stop();
      },
      { threshold: 0 },
    );

    void (async () => {
      const { createLandingScene } = await import("./scene");
      if (disposed) return;

      scene = createLandingScene({
        canvas,
        particleCount:
          window.innerWidth <= MOBILE_BREAKPOINT
            ? MOBILE_PARTICLES
            : DESKTOP_PARTICLES,
        pixelRatio: pixelRatio(),
      });
      if (!scene) return;

      resize();
      setActive(true);

      canvas.addEventListener("webglcontextlost", onContextLost);
      window.addEventListener("resize", resize, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      observer.observe(canvas);

      schedule();
    })();

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
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
      className="lp-canvas-layer"
      data-canvas={active ? "on" : "off"}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="lp-canvas" />
    </div>
  );
}

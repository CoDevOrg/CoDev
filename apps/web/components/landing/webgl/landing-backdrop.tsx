"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the WebGL backdrop.
 *
 * `next/dynamic` with `ssr: false` cannot be called from a Server Component,
 * and `app/page.tsx` has to stay one, so the boundary lives here. Keeping it
 * this thin means three.js and the renderer stay out of the route's first-load
 * bundle and only arrive once `LandingCanvas` decides it wants them.
 */
const LandingCanvas = dynamic(() => import("./landing-canvas"), {
  ssr: false,
  loading: () => null,
});

export function LandingBackdrop() {
  return <LandingCanvas />;
}

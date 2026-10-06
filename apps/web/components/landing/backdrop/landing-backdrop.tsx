"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the canvas backdrop.
 *
 * `next/dynamic` with `ssr: false` cannot be called from a Server Component,
 * and `app/page.tsx` has to stay one, so the boundary lives here. Keeping it
 * this thin means the scene stays out of the route's first-load bundle and
 * only arrives once `LandingCanvas` decides it wants it.
 */
const LandingCanvas = dynamic(() => import("./landing-canvas"), {
  ssr: false,
  loading: () => null,
});

export function LandingBackdrop() {
  return <LandingCanvas />;
}

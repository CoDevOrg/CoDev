"use client";

import { useEffect } from "react";

/**
 * Progressive enhancement for the landing page. Sections render fully visible
 * in the markup; this only opts them into the reveal animation once we know
 * scripting is available, so a failed hydration can never leave a blank page.
 */
export function LandingMotion() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".lp-page");
    if (!page) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    page.dataset.motion = "on";
    const nodes = Array.from(
      page.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    nodes.forEach((node) => observer.observe(node));

    // A slow pointer parallax on the background layers. Values are written as
    // custom properties so the animation itself stays in CSS.
    let frame = 0;
    function onPointerMove(event: PointerEvent) {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        page!.style.setProperty("--lp-px", x.toFixed(3));
        page!.style.setProperty("--lp-py", y.toFixed(3));
      });
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      if (frame) window.cancelAnimationFrame(frame);
      delete page.dataset.motion;
    };
  }, []);

  return null;
}

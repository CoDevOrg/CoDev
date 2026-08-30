"use client";

import { useEffect, useRef, useState } from "react";

import { RequestAccessForm } from "@/components/request-access-form";

/**
 * Three agent-coloured "ghost" cursors that trail the visitor's pointer near
 * the waitlist section, in the same colours as the live-preview crew. One sits
 * left of the pointer, one above it, one to the right. Purely decorative.
 */
const CREW = [
  { id: "codex", color: "var(--lp-orange)", lag: 0.22, angle: 180 },
  { id: "claude", color: "var(--lp-violet)", lag: 0.16, angle: 270 },
  { id: "cursor", color: "var(--lp-sky)", lag: 0.11, angle: 0 },
] as const;

// Distance from the real pointer to each ghost. Close enough to read as a
// little cluster, wide enough that the three arrows never overlap.
const REST_RADIUS = 40;
const HUDDLE_RADIUS = 26;

function GhostArrow({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 2 15 8.4l-4.7 1.15L13 15.1l-2.1 1.05-2.7-5.55L4 14.7Z"
        fill={color}
        stroke="rgba(12,14,16,0.55)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GhostCrew({ huddle }: { huddle: boolean }) {
  const nodesRef = useRef<Array<HTMLDivElement | null>>([]);
  const target = useRef({ x: 0, y: 0 });
  const positions = useRef(CREW.map(() => ({ x: 0, y: 0 })));
  const huddleRef = useRef(huddle);

  useEffect(() => {
    huddleRef.current = huddle;
  }, [huddle]);

  useEffect(() => {
    target.current = {
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.7,
    };
    for (const point of positions.current) {
      point.x = target.current.x;
      point.y = target.current.y;
    }

    const onMove = (event: PointerEvent) => {
      target.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame += 1;
      const close = huddleRef.current;
      CREW.forEach((agent, index) => {
        const el = nodesRef.current[index];
        const pos = positions.current[index];
        if (!el || !pos) return;
        const rad = (agent.angle * Math.PI) / 180;
        const radius = close ? HUDDLE_RADIUS : REST_RADIUS;
        const bob = close ? Math.sin(frame / 16 + index * 2) * 4 : 0;
        const toX = target.current.x + Math.cos(rad) * radius;
        const toY = target.current.y + Math.sin(rad) * radius + bob;
        const ease = close ? Math.min(agent.lag + 0.15, 0.4) : agent.lag;
        pos.x += (toX - pos.x) * ease;
        pos.y += (toY - pos.y) * ease;
        el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      });
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="lp-ghost-crew" aria-hidden="true">
      {CREW.map((agent, index) => (
        <div
          key={agent.id}
          className="lp-ghost"
          ref={(el) => {
            nodesRef.current[index] = el;
          }}
        >
          <GhostArrow color={agent.color} />
        </div>
      ))}
    </div>
  );
}

export function WaitlistInline() {
  const [open, setOpen] = useState(false);
  const [showCrew, setShowCrew] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Show the ghost cursors only while the closing CTA is on screen, and only
  // where a real pointer and motion are welcome.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!finePointer || reduced) return;

    const observer = new IntersectionObserver(
      ([entry]) => setShowCrew(Boolean(entry?.isIntersecting)),
      { rootMargin: "45% 0px 20% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Animate the drawer between 0 and its measured content height, then release
  // to `auto` so the form can grow (validation messages) without clipping.
  useEffect(() => {
    const drawer = drawerRef.current;
    const inner = innerRef.current;
    if (!drawer || !inner) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // On first render just settle into the resting state. Never animate the
    // drawer shut as the page loads.
    if (!mountedRef.current) {
      mountedRef.current = true;
      drawer.style.height = open ? "auto" : "0px";
      return;
    }

    if (reduced) {
      drawer.style.height = open ? "auto" : "0px";
      return;
    }

    if (open) {
      drawer.style.height = `${inner.offsetHeight}px`;
      const done = (event: TransitionEvent) => {
        if (event.propertyName !== "height") return;
        drawer.style.height = "auto";
        drawer.removeEventListener("transitionend", done);
      };
      drawer.addEventListener("transitionend", done);
      return () => drawer.removeEventListener("transitionend", done);
    }

    drawer.style.height = `${inner.offsetHeight}px`;
    // Force a reflow so the browser registers the explicit start height.
    void drawer.offsetHeight;
    drawer.style.height = "0px";
  }, [open]);

  return (
    <div className="lp-waitlist" ref={wrapRef}>
      <button
        type="button"
        className="lp-cta lp-cta-primary lp-waitlist-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Not now" : "Join the waitlist"}
      </button>

      <div
        className={`lp-waitlist-drawer${open ? " is-open" : ""}`}
        ref={drawerRef}
      >
        <div className="lp-waitlist-drawer-inner" ref={innerRef} inert={!open}>
          <RequestAccessForm />
        </div>
      </div>

      {showCrew ? <GhostCrew huddle={open} /> : null}
    </div>
  );
}

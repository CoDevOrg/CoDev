"use client";

import { useEffect, useRef, useState } from "react";

import {
  REQUEST_ACCESS_EVENT,
  REQUEST_ACCESS_TARGET_ID,
} from "@/components/request-access-button";
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

function GhostCrew() {
  const nodesRef = useRef<Array<HTMLDivElement | null>>([]);
  const target = useRef({ x: 0, y: 0 });
  const positions = useRef(CREW.map(() => ({ x: 0, y: 0 })));

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
    const tick = () => {
      CREW.forEach((agent, index) => {
        const el = nodesRef.current[index];
        const pos = positions.current[index];
        if (!el || !pos) return;
        const rad = (agent.angle * Math.PI) / 180;
        const toX = target.current.x + Math.cos(rad) * REST_RADIUS;
        const toY = target.current.y + Math.sin(rad) * REST_RADIUS;
        pos.x += (toX - pos.x) * agent.lag;
        pos.y += (toY - pos.y) * agent.lag;
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
  const [showCrew, setShowCrew] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Show the ghost cursors only while the form is on screen, and only where a
  // real pointer and motion are welcome.
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

  // The hero and nav "Get early access" buttons scroll the page down to this
  // form and drop the caret in the email field.
  useEffect(() => {
    const onRequest = () => {
      const node = wrapRef.current;
      if (!node) return;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      node.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "center",
      });
      window.setTimeout(
        () => {
          node
            .querySelector<HTMLInputElement>('input[name="email"]')
            ?.focus({ preventScroll: true });
        },
        reduced ? 0 : 460,
      );
    };
    window.addEventListener(REQUEST_ACCESS_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_ACCESS_EVENT, onRequest);
  }, []);

  return (
    <div className="lp-waitlist" id={REQUEST_ACCESS_TARGET_ID} ref={wrapRef}>
      <div className="lp-waitlist-card">
        <RequestAccessForm />
      </div>

      {showCrew ? <GhostCrew /> : null}
    </div>
  );
}

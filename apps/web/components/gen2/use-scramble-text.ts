"use client";

import { useEffect, useState } from "react";

const SCRAMBLE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_STEPS = 48;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** A pure frame: characters before `revealed` are real, the rest are random-looking. */
function frame(text: string, revealed: number) {
  return Array.from(text, (char, index) => {
    if (index < revealed || !/[A-Za-z0-9]/.test(char)) return char;
    const hash = (index * 31 + revealed * 17 + char.charCodeAt(0)) % 997;
    return SCRAMBLE_CHARS[hash % SCRAMBLE_CHARS.length];
  }).join("");
}

/**
 * Show `text`, and when it later changes to a different value, scramble it
 * and reveal it left to right. The first value, and users who prefer reduced
 * motion, see the text immediately. Separators (`/`, `:`, `.`) stay in place so
 * a link keeps its shape while it resolves.
 */
export function useScrambleText(text: string, intervalMs = 32) {
  const [state, setState] = useState({ text, revealed: text.length });
  if (state.text !== text) {
    const animate = state.text !== "" && !prefersReducedMotion();
    setState({ text, revealed: animate ? 0 : text.length });
  }
  const animating = state.text === text && state.revealed < text.length;
  useEffect(() => {
    if (!animating) return;
    const step = Math.max(1, Math.ceil(text.length / MAX_STEPS));
    const timer = setInterval(() => {
      setState((current) =>
        current.text === text
          ? {
              text,
              revealed: Math.min(text.length, current.revealed + step),
            }
          : current,
      );
    }, intervalMs);
    return () => clearInterval(timer);
  }, [animating, intervalMs, text]);
  return state.text === text ? frame(text, state.revealed) : text;
}

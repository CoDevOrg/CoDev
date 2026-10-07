/** True when the reader has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Older Safari throws on an unsupported query. Assume the safer answer.
    return true;
  }
}

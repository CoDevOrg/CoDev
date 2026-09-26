/**
 * Capability probe for the landing canvas.
 *
 * This never throws and never logs. The landing e2e suite fails the build on
 * any console error, so a machine without WebGL has to degrade to the static
 * still in complete silence rather than surfacing a warning.
 */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return false;

    // Probing leaks a context on some drivers, and browsers cap how many may
    // exist at once. Hand it back immediately.
    if ("getExtension" in gl) {
      const lose = gl.getExtension("WEBGL_lose_context") as {
        loseContext?: () => void;
      } | null;
      lose?.loseContext?.();
    }
    return true;
  } catch {
    return false;
  }
}

/** True when the reader has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Older Safari throws on an unsupported query. Assume the safer answer.
    return true;
  }
}

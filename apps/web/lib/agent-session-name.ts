const MAX_SESSION_NAME = 32;

/**
 * Derive a short session tab label from the first user prompt.
 * Always returns a non-empty name suitable for POST /agents `{ name }`.
 */
export function deriveAgentSessionName(
  prompt: string,
  fallback = "Agent",
): string {
  const collapsed = prompt.trim().replace(/\s+/g, " ");
  if (!collapsed) return fallback;

  // Keep letters, numbers, and light punctuation; drop control chars / noise.
  const sanitized = collapsed
    .replace(/[^\p{L}\p{N}\s._\-'"!?]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) return fallback;

  if (sanitized.length <= MAX_SESSION_NAME) return sanitized;

  const slice = sanitized.slice(0, MAX_SESSION_NAME);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= 12) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

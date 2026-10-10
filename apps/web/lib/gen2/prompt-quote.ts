/**
 * How the turn context quotes text the member, a client or another chat
 * supplied, so it reads as data inside the prompt: control characters,
 * invisible format characters (bidi overrides, zero-width marks) and line
 * separators never reach the agent unescaped.
 */

/** One value on one line, as a JSON string capped at `max` characters. */
export function quotedValue(value: string, max = 200) {
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ").trim();
  return JSON.stringify(clean.slice(0, max));
}

/** Text that keeps its lines, every one of them behind a `> ` marker. */
export function quotedBlock(text: string) {
  return text
    .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\P{Cc}\n\t]/gu, " ")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** The slice of xterm's buffer API the tail reader needs. */
export type TerminalTailBuffer = {
  length: number;
  getLine(
    y: number,
  ):
    | { isWrapped: boolean; translateToString(trimRight?: boolean): string }
    | undefined;
};

const MAX_LINES = 40;
const MAX_CHARS = 2_000;
// The buffer holds rendered cells, so escapes should be gone already; this
// is a backstop so nothing that steers a terminal reaches a prompt.
const ESCAPES =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g;
const CONTROLS = /(?![\n\t])\p{Cc}/gu;

/**
 * The last lines the member can see in a terminal, as plain text: wrapped
 * rows joined back into their lines, blank rows below the prompt dropped,
 * capped at 40 lines and 2,000 characters.
 */
export function readTerminalTail(buffer: TerminalTailBuffer): string {
  const lines: string[] = [];
  let current = "";
  for (let y = buffer.length - 1; y >= 0; y -= 1) {
    const row = buffer.getLine(y);
    if (!row) continue;
    current = row.translateToString(true) + current;
    if (row.isWrapped) continue;
    if (lines.length || current.trim()) lines.push(current);
    current = "";
    if (lines.length >= MAX_LINES) break;
  }
  const text = lines
    .reverse()
    .join("\n")
    .replace(ESCAPES, "")
    .replace(CONTROLS, "");
  return text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text;
}

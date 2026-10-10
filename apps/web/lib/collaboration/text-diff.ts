/** One replacement in the old text: `[from, to)` becomes `insert`. */
export interface TextHunk {
  from: number;
  to: number;
  insert: string;
}

/** Above this many changed lines per side, a single hunk is cheaper than LCS. */
const MAX_LCS_LINES = 500;

/**
 * Minimal line-level hunks turning `before` into `after`, ordered by position.
 * Unchanged text stays untouched, so concurrent cursors and Yjs history in it
 * survive an agent's edit. Pure and dependency-free for server and browser.
 */
export function diffTextHunks(before: string, after: string): TextHunk[] {
  if (before === after) return [];
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const offsets = lineOffsets(a);
  const middle =
    endA - start > MAX_LCS_LINES || endB - start > MAX_LCS_LINES
      ? [{ a0: start, a1: endA, b0: start, b1: endB }]
      : lcsHunks(a, b, start, endA, start, endB);
  return middle.map((hunk) => ({
    from: offsets[hunk.a0]!,
    to: offsets[hunk.a1]!,
    insert: b.slice(hunk.b0, hunk.b1).join(""),
  }));
}

/** Lines keep their trailing newline, so joining them restores the text. */
function splitLines(text: string) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function lineOffsets(lines: string[]) {
  const offsets = [0];
  for (const line of lines)
    offsets.push(offsets[offsets.length - 1]! + line.length);
  return offsets;
}

type LineHunk = { a0: number; a1: number; b0: number; b1: number };

function lcsHunks(
  a: string[],
  b: string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): LineHunk[] {
  const n = a1 - a0;
  const m = b1 - b0;
  const table = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      table[i * (m + 1) + j] =
        a[a0 + i] === b[b0 + j]
          ? table[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(
              table[(i + 1) * (m + 1) + j]!,
              table[i * (m + 1) + j + 1]!,
            );
  const hunks: LineHunk[] = [];
  let open: LineHunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[a0 + i] === b[b0 + j]) {
      if (open) hunks.push(open);
      open = null;
      i += 1;
      j += 1;
      continue;
    }
    open ??= { a0: a0 + i, a1: a0 + i, b0: b0 + j, b1: b0 + j };
    const takeA =
      j >= m ||
      (i < n && table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!);
    if (takeA) open.a1 = a0 + ++i;
    else open.b1 = b0 + ++j;
  }
  if (open) hunks.push(open);
  return hunks;
}

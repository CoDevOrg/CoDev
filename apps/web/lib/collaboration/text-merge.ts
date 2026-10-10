import { diffTextHunks, type TextHunk } from "./text-diff";

/** True when two changes to the same original text touch the same lines. */
function collides(left: TextHunk, right: TextHunk) {
  // Two insertions at one point can both be kept, one after the other.
  if (left.from === left.to && right.from === right.to) return false;
  if (left.from === left.to)
    return left.from > right.from && left.from < right.to;
  if (right.from === right.to)
    return right.from > left.from && right.from < left.to;
  return left.from < right.to && right.from < left.to;
}

/**
 * Moves a position in `base` to where it sits after `ours`. An insertion of
 * ours exactly at the position counts as before it only for a start
 * position, so their change lands after our text and never deletes it.
 */
function shift(position: number, ours: TextHunk[], start: boolean) {
  let offset = 0;
  for (const own of ours) {
    const insertion = own.from === own.to;
    const before = insertion
      ? own.from < position || (start && own.from === position)
      : own.to <= position;
    if (before) offset += own.insert.length - (own.to - own.from);
  }
  return position + offset;
}

/**
 * Three-way merge for live editing: the workspace file went from `base` to
 * `theirs` (an agent wrote it) while the shared document went from `base` to
 * `ours`. Returns `theirs`'s changes as hunks to apply to `ours`, or null
 * when both changed the same lines and a person has to choose.
 */
export function rebaseTextHunks(
  base: string,
  ours: string,
  theirs: string,
): TextHunk[] | null {
  const mine = diffTextHunks(base, ours);
  const incoming = diffTextHunks(base, theirs);
  if (incoming.some((hunk) => mine.some((own) => collides(hunk, own))))
    return null;
  return incoming.map((hunk) => {
    const from = shift(hunk.from, mine, true);
    const to = hunk.from === hunk.to ? from : shift(hunk.to, mine, false);
    return { from, to, insert: hunk.insert };
  });
}

/** Applies hunks to a string, for checking a merge without Yjs. */
export function applyTextHunks(text: string, hunks: TextHunk[]) {
  return [...hunks]
    .sort((left, right) => right.from - left.from)
    .reduce(
      (result, hunk) =>
        result.slice(0, hunk.from) + hunk.insert + result.slice(hunk.to),
      text,
    );
}

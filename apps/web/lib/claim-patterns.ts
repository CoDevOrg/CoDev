/**
 * Whether two path claims cover any of the same files.
 *
 * A claim is either an exact repo-relative path or a `dir/**` glob, and this is
 * the single predicate that decides they collide. It lives on its own, free of
 * database imports, because both the write path (`createPathClaim`, which marks
 * claims contested with it) and the read path (the coordination snapshot the
 * IDE panel renders) have to agree: a pair the writer called contested must not
 * look uncontested to whatever reports it.
 */
export function claimPatternsOverlap(left: string, right: string) {
  const leftDirectory = left.endsWith("/**");
  const rightDirectory = right.endsWith("/**");
  const leftPath = leftDirectory ? left.slice(0, -3) : left;
  const rightPath = rightDirectory ? right.slice(0, -3) : right;
  if (!leftDirectory && !rightDirectory) return leftPath === rightPath;
  if (leftDirectory && rightDirectory) {
    return (
      leftPath === rightPath ||
      leftPath.startsWith(`${rightPath}/`) ||
      rightPath.startsWith(`${leftPath}/`)
    );
  }
  const directory = leftDirectory ? leftPath : rightPath;
  const exact = leftDirectory ? rightPath : leftPath;
  return exact.startsWith(`${directory}/`);
}

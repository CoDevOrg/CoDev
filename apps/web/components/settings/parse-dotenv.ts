const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const ENV_NAME_HINT = "Use letters, numbers, and underscores.";

/** `null` when the name is acceptable, otherwise a message for the member. */
export function environmentNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return "Names can be at most 128 characters.";
  if (/^[0-9]/.test(trimmed)) return "A name cannot start with a number.";
  return NAME_PATTERN.test(trimmed) ? null : ENV_NAME_HINT;
}

export type ParsedDotenv = {
  entries: { name: string; value: string }[];
  /** 1-based line numbers that looked like assignments but could not be used. */
  skipped: number[];
};

function unquote(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, "\n") : inner;
  }
  // An unquoted value ends at an inline ` #` comment.
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/**
 * Reads pasted `.env` text. Later duplicates win, blank lines and `#` comments
 * are ignored, and a line that cannot be used is reported rather than dropped
 * silently so the member knows what was not imported.
 */
export function parseDotenv(text: string): ParsedDotenv {
  const byName = new Map<string, string>();
  const skipped: number[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const assignment = trimmed.replace(/^export\s+/, "");
    const equals = assignment.indexOf("=");
    if (equals === -1) {
      skipped.push(index + 1);
      return;
    }
    const name = assignment.slice(0, equals).trim();
    const value = unquote(assignment.slice(equals + 1));
    if (environmentNameError(name) !== null || !name || !value) {
      skipped.push(index + 1);
      return;
    }
    byName.set(name, value);
  });

  return {
    entries: [...byName].map(([name, value]) => ({ name, value })),
    skipped,
  };
}

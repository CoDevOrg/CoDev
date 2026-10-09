/**
 * Hides secrets in an uploaded agent session before anything else reads it.
 *
 * An imported chat is visible to every workspace member, and native resume
 * hands the file to whichever editor continues it, so the redacted bytes are
 * the only copy CoDev keeps. Every JSON string value is rewritten in place;
 * a line that is not JSON is redacted as plain text. Encrypted reasoning is
 * opaque to us and to the reader, and rewriting it would break resume.
 */

const PLACEHOLDER = "[REDACTED]";

type Rule = {
  kind: string;
  pattern: RegExp;
  replace: string;
};

// Order matters: specific token formats first, so the generic assignment
// rule sees their placeholders rather than counting them twice.
const RULES: Rule[] = [
  {
    kind: "private key",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "Anthropic key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "OpenAI key",
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "AWS key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "Slack token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "JWT",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: "connection string password",
    pattern:
      /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?!\[REDACTED)([^\s@/]{3,})@/gi,
    replace: `$1${PLACEHOLDER}@`,
  },
  {
    // `NAME=value` with a secret-looking name and a value that looks
    // generated: 12+ characters mixing letters and digits. Code identifiers,
    // `{{ secrets.X }}` references, and resource names don't.
    kind: "secret assignment",
    pattern:
      /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)(?!\[REDACTED)(?=[^\s"'`{}$]*\d)(?=[^\s"'`{}$]*[A-Za-z])([^\s"'`{}$]{12,})\3/g,
    replace: `$1$2$3${PLACEHOLDER}$3`,
  },
];

const OPAQUE_KEYS = new Set(["encrypted_content"]);

type Counts = Map<string, number>;

function redactString(value: string, counts: Counts): string {
  return RULES.reduce((text, rule) => {
    const hits = text.match(rule.pattern)?.length ?? 0;
    if (!hits) return text;
    counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + hits);
    return text.replace(rule.pattern, rule.replace);
  }, value);
}

function redactValue(value: unknown, counts: Counts): unknown {
  if (typeof value === "string") return redactString(value, counts);
  if (Array.isArray(value))
    return value.map((entry) => redactValue(entry, counts));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        OPAQUE_KEYS.has(key) ? entry : redactValue(entry, counts),
      ]),
    );
  }
  return value;
}

function redactLine(line: string, counts: Counts): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return redactString(line, counts);
  }
  const before = sumCounts(counts);
  const redacted = redactValue(parsed, counts);
  // Untouched lines keep their exact bytes.
  return sumCounts(counts) === before ? line : JSON.stringify(redacted);
}

function sumCounts(counts: Counts) {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

export function redactSessionJsonl(contents: string) {
  const counts: Counts = new Map();
  const text = contents
    .split("\n")
    .map((line) => (line.trim() ? redactLine(line, counts) : line))
    .join("\n");
  return {
    text,
    redactions: [...counts].map(([kind, count]) => ({ kind, count })),
  };
}

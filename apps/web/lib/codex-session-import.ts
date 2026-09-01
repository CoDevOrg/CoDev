import { z } from "zod";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class InvalidCodexRolloutError extends Error {}

export type ParsedCodexRollout = {
  sessionId: string;
  timestamp: Date;
};

const rolloutHeaderSchema = z.object({
  type: z.literal("session_meta"),
  payload: z.object({
    id: z.string().regex(UUID_RE),
    timestamp: z.string(),
  }),
});

/**
 * Parses and validates the first line of an uploaded Codex rollout (.jsonl)
 * file -- the only line this import path needs to trust. Codex writes a
 * `session_meta` event as line one of every rollout it records, carrying the
 * session's id and start time; everything after it is conversation history
 * Codex itself will re-read once the file lands in its session store, so
 * this never needs to parse further than line one.
 */
export function parseCodexRolloutHeader(contents: string): ParsedCodexRollout {
  const firstLine = contents.split("\n", 1)[0]?.trim();
  if (!firstLine) {
    throw new InvalidCodexRolloutError("The file is empty.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new InvalidCodexRolloutError(
      "The first line is not valid JSON. This doesn't look like a Codex rollout file.",
    );
  }
  const header = rolloutHeaderSchema.safeParse(parsed);
  if (!header.success) {
    throw new InvalidCodexRolloutError(
      "The first line isn't a Codex session_meta event. This doesn't look like a Codex rollout file.",
    );
  }
  const timestamp = new Date(header.data.payload.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new InvalidCodexRolloutError(
      "The session's recorded timestamp is invalid.",
    );
  }
  return { sessionId: header.data.payload.id, timestamp };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export type CodexRolloutPath = {
  /** `<year>/<month>/<day>`, the directory Codex nests rollouts under. */
  directory: string;
  filename: string;
  /** `directory/filename`, the path relative to $CODEX_HOME/sessions. */
  relativePath: string;
};

/**
 * The path this rollout would live at under a real Codex session store
 * (`$CODEX_HOME/sessions/<relativePath>`). Derived from the UTC components of
 * the session's own recorded timestamp rather than the uploader's local wall
 * clock, since that isn't reliably known once the file has left their
 * machine. `codex resume <id>` matches sessions by the id recorded inside
 * the file, not by filename, so this only needs to be a plausible, unique,
 * discoverable path under `sessions/`, not a byte-exact reproduction of
 * what the original machine would have named it.
 */
export function codexRolloutSessionPath(
  rollout: ParsedCodexRollout,
): CodexRolloutPath {
  const at = rollout.timestamp;
  const year = String(at.getUTCFullYear());
  const month = pad(at.getUTCMonth() + 1);
  const day = pad(at.getUTCDate());
  const stamp = `${year}-${month}-${day}T${pad(at.getUTCHours())}-${pad(at.getUTCMinutes())}-${pad(at.getUTCSeconds())}`;
  const directory = `${year}/${month}/${day}`;
  const filename = `rollout-${stamp}-${rollout.sessionId}.jsonl`;
  return { directory, filename, relativePath: `${directory}/${filename}` };
}

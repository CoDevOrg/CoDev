import { describe, expect, it } from "vitest";

import {
  InvalidCodexRolloutError,
  codexRolloutSessionPath,
  parseCodexRolloutHeader,
} from "./codex-session-import";

const SESSION_ID = "019a88ba-5df0-77c1-83e3-1413a0bce76d";

function rolloutContents(
  headerOverrides: Record<string, unknown> = {},
): string {
  const header = {
    timestamp: "2025-11-15T18:15:06.507Z",
    type: "session_meta",
    payload: {
      id: SESSION_ID,
      timestamp: "2025-11-15T18:15:06.480Z",
      cwd: "/Users/example/project",
      ...headerOverrides,
    },
  };
  return [
    JSON.stringify(header),
    JSON.stringify({ type: "response_item", payload: { type: "message" } }),
  ].join("\n");
}

describe("parseCodexRolloutHeader", () => {
  it("reads the session id and timestamp from a real rollout's first line", () => {
    const rollout = parseCodexRolloutHeader(rolloutContents());
    expect(rollout.sessionId).toBe(SESSION_ID);
    expect(rollout.timestamp.toISOString()).toBe("2025-11-15T18:15:06.480Z");
  });

  it("ignores every line after the header", () => {
    const rollout = parseCodexRolloutHeader(
      rolloutContents() + "\nnot even valid JSON at all {{{",
    );
    expect(rollout.sessionId).toBe(SESSION_ID);
  });

  it.each([
    ["an empty file", ""],
    ["a whitespace-only file", "   \n\n"],
    ["a first line that isn't JSON", "definitely not json\n{}"],
    [
      "a first line that isn't a session_meta event",
      JSON.stringify({ type: "response_item", payload: {} }),
    ],
    [
      "a session id that isn't a UUID",
      JSON.stringify({
        type: "session_meta",
        payload: { id: "not-a-uuid", timestamp: "2025-11-15T18:15:06.480Z" },
      }),
    ],
    [
      "a timestamp that doesn't parse",
      JSON.stringify({
        type: "session_meta",
        payload: { id: SESSION_ID, timestamp: "not-a-date" },
      }),
    ],
  ])("rejects %s", (_label, contents) => {
    expect(() => parseCodexRolloutHeader(contents)).toThrow(
      InvalidCodexRolloutError,
    );
  });
});

describe("codexRolloutSessionPath", () => {
  it("nests the rollout under year/month/day derived from UTC, zero-padded", () => {
    const rollout = parseCodexRolloutHeader(rolloutContents());
    const path = codexRolloutSessionPath(rollout);
    expect(path.directory).toBe("2025/11/15");
    expect(path.filename).toBe(
      `rollout-2025-11-15T18-15-06-${SESSION_ID}.jsonl`,
    );
    expect(path.relativePath).toBe(`2025/11/15/${path.filename}`);
  });

  it("zero-pads single-digit months, days, and times", () => {
    const rollout = parseCodexRolloutHeader(
      rolloutContents({ timestamp: "2025-01-02T03:04:05.000Z" }),
    );
    const path = codexRolloutSessionPath(rollout);
    expect(path.directory).toBe("2025/01/02");
    expect(path.filename).toBe(
      `rollout-2025-01-02T03-04-05-${SESSION_ID}.jsonl`,
    );
  });
});

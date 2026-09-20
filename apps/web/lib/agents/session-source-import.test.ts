import { describe, expect, it } from "vitest";

import { decodeSessionCapsuleTransport } from "./session-capsule-transport";
import {
  importSessionSource,
  SessionSourceImportError,
} from "./session-source-import";

const id = "019a88ba-5df0-77c1-83e3-1413a0bce76d";
function rollout(
  git: unknown = {
    repository_url: "https://github.com/codev/example.git",
    commit_hash: "a".repeat(40),
    branch: "main",
  },
) {
  return new TextEncoder().encode(
    [
      JSON.stringify({
        type: "session_meta",
        payload: { id, timestamp: "2025-11-15T18:15:06.480Z", git },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2025-11-15T18:16:00Z",
        payload: { type: "user_message", message: "Fix the import" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2025-11-15T18:17:00Z",
        payload: { type: "agent_message", message: "The fix is ready" },
      }),
    ].join("\n"),
  );
}

describe("Codex source adapter", () => {
  it("creates a verified capsule with a private native rollout and normalized transcript", () => {
    const source = rollout();
    const decoded = decodeSessionCapsuleTransport(
      importSessionSource("codex", source),
    );
    expect(decoded.capsule.source).toMatchObject({
      provider: "codex",
      externalSessionId: id,
    });
    expect(decoded.capsule.repository).toMatchObject({
      host: "github.com",
      path: "codev/example",
      baseCommitSha: "a".repeat(40),
    });
    expect(
      decoded.capsule.transcript.map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: "user", text: "Fix the import" },
      { role: "assistant", text: "The fix is ready" },
    ]);
    expect(decoded.capsule.handoff.currentObjective).toBe("Fix the import");
    expect(decoded.files.get("provider/codex-rollout.jsonl")).toEqual(source);
    expect(decoded.capsule.exportedAt).toBe("2025-11-15T18:15:06.480Z");
  });

  it("rejects missing Git identity and unavailable adapters", () => {
    expect(() => importSessionSource("codex", rollout(null))).toThrow(
      SessionSourceImportError,
    );
    expect(() => importSessionSource("claude", rollout())).toThrow(
      "not available yet",
    );
  });

  it("keeps interleaved Codex messages in rollout order", () => {
    const additionalTurns = [
      { type: "user_message", message: "One more question" },
      { type: "agent_message", message: "One more answer" },
    ].map((payload) => JSON.stringify({ type: "event_msg", payload }));
    const source = new TextEncoder().encode(
      `${new TextDecoder().decode(rollout())}\n${additionalTurns.join("\n")}`,
    );
    const { capsule } = decodeSessionCapsuleTransport(
      importSessionSource("codex", source),
    );

    expect(capsule.transcript.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
});

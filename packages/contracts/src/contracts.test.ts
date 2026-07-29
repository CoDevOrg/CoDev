import { describe, expect, it } from "vitest";

import {
  agentActivityEventSchema,
  collaborationClientMessageSchema,
  collaborationServerMessageSchema,
  conflictResolutionInputSchema,
  coordinationMessageInputSchema,
  createPathClaimSchema,
  FakeSandboxBackend,
  terminalPollSchema,
  workspaceEventSchema,
  workspaceSchema,
} from "./index";

const id = "019c8c2e-c801-7a53-b556-62475c4a60e7";

describe("workspace contracts", () => {
  it("accepts a valid workspace", () => {
    const workspace = workspaceSchema.parse({
      id,
      ownerId: id,
      repository: "codev/example",
      baseSha: "a".repeat(40),
      status: "ready",
      lastActivityAt: "2026-07-28T12:00:00.000Z",
      expiresAt: "2026-07-28T16:00:00.000Z",
    });

    expect(workspace.repository).toBe("codev/example");
  });

  it("requires strictly sequenced terminal chunks", () => {
    expect(
      terminalPollSchema.parse({
        chunks: [{ sequence: 1, data: "ready\r\n" }],
        nextSequence: 2,
        exited: false,
        exitCode: null,
      }).chunks[0]?.sequence,
    ).toBe(1);
    expect(() =>
      terminalPollSchema.parse({
        chunks: [{ sequence: 0, data: "invalid" }],
        nextSequence: 1,
        exited: false,
        exitCode: null,
      }),
    ).toThrow();
  });

  it("rejects an invalid event payload", () => {
    expect(() =>
      workspaceEventSchema.parse({
        id,
        workspaceId: id,
        sequence: 1,
        createdAt: "2026-07-28T12:00:00.000Z",
        type: "claim.changed",
        data: { status: "invented" },
      }),
    ).toThrow();
  });

  it("accepts durable agent tool activity", () => {
    expect(
      agentActivityEventSchema.parse({
        id,
        workspaceId: id,
        sessionId: id,
        turnId: id,
        type: "tool.called",
        payload: { name: "read_file", arguments: '{"path":"README.md"}' },
        createdAt: "2026-07-29T20:00:00.000Z",
      }).type,
    ).toBe("tool.called");
  });
});

describe("collaboration contracts", () => {
  it("accepts document subscriptions and bounded Yjs updates", () => {
    expect(
      collaborationClientMessageSchema.parse({
        type: "subscribe",
        path: "src/index.ts",
        stateVector: "AQID",
      }).type,
    ).toBe("subscribe");

    expect(() =>
      collaborationClientMessageSchema.parse({
        type: "update",
        path: "/etc/passwd",
        update: "AQID",
      }),
    ).toThrow();
  });

  it("does not accept client-supplied identities", () => {
    expect(() =>
      collaborationClientMessageSchema.parse({
        type: "awareness",
        path: "src/index.ts",
        update: "AQID",
        actorId: id,
      }),
    ).toThrow();

    expect(
      collaborationServerMessageSchema.parse({
        type: "conflict",
        worktreeId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        path: "src/index.ts",
        snapshotRevision: "r1",
        filesystemRevision: "r2",
        message: "Both copies changed.",
      }).type,
    ).toBe("conflict");
  });
});

describe("agent coordination contracts", () => {
  it("only accepts exact paths and directory claims", () => {
    expect(
      createPathClaimSchema.parse({
        path: "src/**",
        intent: "Refactor the source tree",
        revision: "abc",
      }).ttlSeconds,
    ).toBe(900);
    expect(() =>
      createPathClaimSchema.parse({
        path: "src/*.ts",
        intent: "Too broad",
        revision: "abc",
      }),
    ).toThrow();
  });

  it("validates negotiation payloads by message kind", () => {
    expect(
      coordinationMessageInputSchema.parse({
        toSessionId: id,
        kind: "note",
        payload: { body: "I am changing the parser." },
      }).kind,
    ).toBe("note");
    expect(() =>
      coordinationMessageInputSchema.parse({
        toSessionId: id,
        kind: "claim_response",
        payload: { body: "not structured" },
        correlationId: id,
        responseToId: id,
      }),
    ).toThrow();
  });

  it("requires merged contents only for manual merges", () => {
    expect(
      conflictResolutionInputSchema.parse({
        path: "src/index.ts",
        strategy: "merged",
        expectedSnapshotRevision: "r1",
        expectedFilesystemRevision: "r2",
        mergedContents: "resolved",
      }).strategy,
    ).toBe("merged");
  });
});

describe("fake sandbox", () => {
  it("stores files behind the sandbox contract", async () => {
    const sandbox = new FakeSandboxBackend();

    const result = await sandbox.writeFile(
      "worktree",
      "README.md",
      "# Demo",
      "r1",
    );

    await expect(sandbox.readFile("worktree", "README.md")).resolves.toBe(
      "# Demo",
    );
    expect(result.revision).toBe("r1:next");
  });
});

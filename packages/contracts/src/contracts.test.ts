import { describe, expect, it } from "vitest";

import {
  collaborationClientMessageSchema,
  collaborationServerMessageSchema,
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
        path: "src/index.ts",
        snapshotRevision: "r1",
        filesystemRevision: "r2",
        message: "Both copies changed.",
      }).type,
    ).toBe("conflict");
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

import { describe, expect, it } from "vitest";

import {
  FakeSandboxBackend,
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

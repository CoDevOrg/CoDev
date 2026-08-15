import { describe, expect, it } from "vitest";

import {
  agentActivityEventSchema,
  agentCapacitySchema,
  enqueueSharedSessionTurn,
  collaborationClientMessageSchema,
  collaborationServerMessageSchema,
  conflictReportInputSchema,
  conflictResolutionInputSchema,
  coordinationMessageInputSchema,
  createPathClaimSchema,
  designPartnerFeedbackInputSchema,
  FakeSandboxBackend,
  createPublicationSchema,
  createPullRequestSchema,
  terminalPollSchema,
  sharedSessionEventSchema,
  sharedSessionSchema,
  workspaceEventSchema,
  presenceEventSchema,
  workspaceRoleCapabilities,
  workspaceRoleCapabilitiesSchema,
  workspaceSchema,
  MAX_PARALLEL_AGENT_SESSIONS,
} from "./index";

const id = "019c8c2e-c801-7a53-b556-62475c4a60e7";

describe("workspace contracts", () => {
  it("defines the Viewer, Collaborator, and Maintainer capability sets", () => {
    expect(
      workspaceRoleCapabilitiesSchema.parse(workspaceRoleCapabilities.viewer),
    ).toMatchObject({
      role: "viewer",
      canView: true,
      canEdit: false,
      canCoSteer: false,
      canUseTerminal: false,
      canManageMembers: false,
      canApproveIntegration: false,
    });
    expect(workspaceRoleCapabilities.collaborator.canEdit).toBe(true);
    expect(workspaceRoleCapabilities.collaborator.canManageMembers).toBe(false);
    expect(workspaceRoleCapabilities.maintainer.canManageMembers).toBe(true);
    expect(workspaceRoleCapabilities.maintainer.canApproveIntegration).toBe(
      true,
    );
  });

  it("defines a three-agent workspace capacity", () => {
    expect(MAX_PARALLEL_AGENT_SESSIONS).toBe(3);
    expect(
      agentCapacitySchema.parse({
        maxActiveSessions: 3,
        activeSessions: 2,
        availableSlots: 1,
      }).availableSlots,
    ).toBe(1);
    expect(
      agentCapacitySchema.parse({
        maxActiveSessions: 3,
        activeSessions: 3,
        availableSlots: 0,
      }),
    ).toMatchObject({ activeSessions: 3, availableSlots: 0 });
    expect(() =>
      agentCapacitySchema.parse({
        maxActiveSessions: 2,
        activeSessions: 0,
        availableSlots: 2,
      }),
    ).toThrow();
  });

  it("accepts a valid workspace", () => {
    const workspace = workspaceSchema.parse({
      id,
      ownerId: id,
      repository: "codev/example",
      repositoryVisibility: "private",
      baseSha: "a".repeat(40),
      status: "ready",
      lastActivityAt: "2026-07-28T12:00:00.000Z",
      expiresAt: "2026-07-28T16:00:00.000Z",
    });

    expect(workspace.repository).toBe("codev/example");
    expect(workspace.repositoryVisibility).toBe("private");
  });

  it("bounds design-partner feedback without product secrets", () => {
    expect(
      designPartnerFeedbackInputSchema.parse({
        category: "workflow",
        rating: 4,
        message: "The publication recovery flow was clear.",
        page: "/settings",
        workspaceId: null,
      }).rating,
    ).toBe(4);
    expect(() =>
      designPartnerFeedbackInputSchema.parse({
        category: "workflow",
        rating: 6,
        message: "too short",
        page: null,
        workspaceId: null,
      }),
    ).toThrow();
  });

  it("validates personal environment variable names", async () => {
    const { createEnvironmentVariableSchema } = await import("./domain");
    expect(
      createEnvironmentVariableSchema.parse({
        name: "DATABASE_URL",
        value: "postgres://example",
      }).name,
    ).toBe("DATABASE_URL");
    expect(() =>
      createEnvironmentVariableSchema.parse({
        name: "not valid",
        value: "x",
      }),
    ).toThrow();
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

  it("accepts durable joined, active-file, cursor, and left presence events", () => {
    const base = {
      id,
      workspaceId: id,
      sequence: 1,
      createdAt: "2026-07-28T12:00:00.000Z",
    };

    expect(
      presenceEventSchema.parse({
        ...base,
        type: "presence.joined",
        data: {
          userId: id,
          worktreeId: null,
          activePath: null,
          cursor: null,
        },
      }).type,
    ).toBe("presence.joined");
    expect(
      presenceEventSchema.parse({
        ...base,
        sequence: 2,
        type: "presence.active_file.changed",
        data: { userId: id, path: "src/index.ts", previousPath: null },
      }),
    ).toMatchObject({ data: { path: "src/index.ts" } });
    expect(
      presenceEventSchema.parse({
        ...base,
        sequence: 3,
        type: "presence.cursor.changed",
        data: {
          userId: id,
          path: "src/index.ts",
          cursor: { anchor: 12, head: 18 },
        },
      }),
    ).toMatchObject({ data: { cursor: { anchor: 12, head: 18 } } });
    expect(
      presenceEventSchema.parse({
        ...base,
        sequence: 4,
        type: "presence.left",
        data: {
          userId: id,
          worktreeId: null,
          activePath: "src/index.ts",
          cursor: { anchor: 18, head: 18 },
          reason: "disconnect",
        },
      }),
    ).toMatchObject({ data: { reason: "disconnect" } });
    expect(() =>
      presenceEventSchema.parse({
        ...base,
        type: "presence.cursor.changed",
        data: {
          userId: id,
          path: "src/index.ts",
          cursor: { anchor: -1, head: 2 },
        },
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

  it("defines a shared session with an explicitly ordered empty queue", () => {
    const session = sharedSessionSchema.parse({
      sessionId: id,
      workspaceId: id,
      ownerId: id,
      worktreeId: id,
      provider: "codex",
      model: "gpt-5",
      state: "idle",
      activeTurnId: null,
      streamCursor: 0,
      queue: [],
    });

    expect(session.queue).toEqual([]);
    expect(
      sharedSessionEventSchema.parse({
        id,
        workspaceId: id,
        sessionId: id,
        sequence: 1,
        createdAt: "2026-07-30T12:00:00.000Z",
        type: "shared_session.created",
        data: {
          ownerId: id,
          worktreeId: id,
          provider: "codex",
          model: "gpt-5",
        },
      }).type,
    ).toBe("shared_session.created");
  });

  it("assigns monotonically increasing positions to queued turns", () => {
    const first = enqueueSharedSessionTurn([], {
      id,
      sessionId: id,
      authorId: id,
      prompt: "Inspect the repository",
      enqueuedAt: "2026-07-30T12:00:00.000Z",
    });
    const second = enqueueSharedSessionTurn(first.queue, {
      id: "019c8c2e-c801-7a53-b556-62475c4a60e8",
      sessionId: id,
      authorId: id,
      prompt: "Summarize the findings",
      enqueuedAt: "2026-07-30T12:01:00.000Z",
    });

    expect(second.entry.queuePosition).toBe(2);
    expect(second.queue.map((entry) => entry.queuePosition)).toEqual([1, 2]);
    expect(second.queue.map((entry) => entry.prompt)).toEqual([
      "Inspect the repository",
      "Summarize the findings",
    ]);
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

  it("accepts a native editor report that preserves both versions", () => {
    expect(
      conflictReportInputSchema.parse({
        path: "README.md",
        collaborativeContents: "editor revision",
      }),
    ).toEqual({
      path: "README.md",
      collaborativeContents: "editor revision",
    });
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

describe("publication contracts", () => {
  it("accepts only immutable CoDev branch refs", () => {
    expect(
      createPublicationSchema.parse({
        branchName: "codev/design-partner-demo",
        expectedHeadSha: "a".repeat(40),
      }).branchName,
    ).toBe("codev/design-partner-demo");

    for (const branchName of [
      "main",
      "codev/../main",
      "codev/.hidden",
      "codev/demo.lock",
      "codev/Demo",
    ]) {
      expect(() =>
        createPublicationSchema.parse({
          branchName,
          expectedHeadSha: "a".repeat(40),
        }),
      ).toThrow();
    }
  });

  it("requires a titled pull request from an immutable CoDev branch", () => {
    expect(
      createPullRequestSchema.parse({
        branchName: "codev/design-partner-demo",
        title: "CoDev: design partner demo",
      }),
    ).toEqual({
      branchName: "codev/design-partner-demo",
      title: "CoDev: design partner demo",
    });

    expect(() =>
      createPullRequestSchema.parse({
        branchName: "main",
        title: "Ship",
      }),
    ).toThrow();
    expect(() =>
      createPullRequestSchema.parse({
        branchName: "codev/demo",
        title: "",
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

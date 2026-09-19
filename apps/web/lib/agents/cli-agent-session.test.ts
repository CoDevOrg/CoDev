import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("../platform/database", () => ({
  getDatabase: databaseMocks.getDatabase,
}));

import {
  closeCliAgentSession,
  CLI_SESSION_STALE_AFTER_MS,
  mintCoordinationToken,
  mintWorkspaceCoordinationToken,
  openCoordinationToken,
  openWorkspaceCoordinationToken,
  touchCliAgentSession,
} from "./cli-agent-session";

const INPUT = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
};

describe("coordination token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-value";
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("round-trips a freshly minted token", () => {
    const opened = openCoordinationToken(mintCoordinationToken(INPUT));
    expect(opened).toMatchObject(INPUT);
    expect(opened?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload", () => {
    const [payload, signature] = mintCoordinationToken(INPUT).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...INPUT,
        sessionId: "44444444-4444-4444-8444-444444444444",
      }),
      "utf8",
    ).toString("base64url");
    expect(openCoordinationToken(`${forged}.${signature}`)).toBeNull();
    expect(openCoordinationToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintCoordinationToken(INPUT);
    process.env.AUTH_SECRET = "a-different-secret";
    expect(openCoordinationToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintCoordinationToken(INPUT);
    const [payload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    decoded.expiresAt = Date.now() - 1;
    const staleRepack = Buffer.from(JSON.stringify(decoded), "utf8").toString(
      "base64url",
    );
    // Re-sign so only expiry, not the signature, is what fails.
    const sig = createHmac("sha256", "test-secret-value")
      .update(`codev-coordination-mcp-v1.${staleRepack}`)
      .digest("base64url");
    expect(openCoordinationToken(`${staleRepack}.${sig}`)).toBeNull();
  });

  it("returns null for junk", () => {
    expect(openCoordinationToken(undefined)).toBeNull();
    expect(openCoordinationToken("")).toBeNull();
    expect(openCoordinationToken("no-dot")).toBeNull();
    expect(openCoordinationToken("a.b.c")).toBeNull();
  });
});

describe("workspace coordination token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-value";
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("round-trips and carries only the workspace id", () => {
    const opened = openWorkspaceCoordinationToken(
      mintWorkspaceCoordinationToken(INPUT.workspaceId),
    );
    expect(opened?.workspaceId).toBe(INPUT.workspaceId);
    expect(opened?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("does not accept a session token, and vice versa", () => {
    // Different domain separators, so the signatures never cross-validate.
    expect(
      openWorkspaceCoordinationToken(mintCoordinationToken(INPUT)),
    ).toBeNull();
    expect(
      openCoordinationToken(mintWorkspaceCoordinationToken(INPUT.workspaceId)),
    ).toBeNull();
  });

  it("rejects a tampered workspace id", () => {
    const [, signature] = mintWorkspaceCoordinationToken(
      INPUT.workspaceId,
    ).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        workspaceId: "other",
        expiresAt: Date.now() + 1000,
        nonce: "x",
      }),
      "utf8",
    ).toString("base64url");
    expect(openWorkspaceCoordinationToken(`${forged}.${signature}`)).toBeNull();
  });
});

function updateQuery(returned: unknown[] = []) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(returned);
  return query;
}

describe("CLI session lifecycle", () => {
  beforeEach(() => {
    databaseMocks.getDatabase.mockReset();
  });

  it("touches only an active CLI session and its worktree", async () => {
    const sessionUpdate = updateQuery([
      { id: "session-1", worktreeId: "worktree-1" },
    ]);
    const worktreeUpdate = updateQuery();
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      update: vi
        .fn()
        .mockReturnValueOnce(sessionUpdate)
        .mockReturnValueOnce(worktreeUpdate),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await expect(
      touchCliAgentSession({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({ id: "session-1", worktreeId: "worktree-1" });
    expect(sessionUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running" }),
    );
    expect(worktreeUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("closes a CLI session and discards an otherwise unused worktree", async () => {
    const sessionQuery = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi
        .fn()
        .mockResolvedValue([{ id: "session-1", worktreeId: "worktree-1" }]),
    };
    sessionQuery.from.mockReturnValue(sessionQuery);
    sessionQuery.where.mockReturnValue(sessionQuery);
    const siblingQuery = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    siblingQuery.from.mockReturnValue(siblingQuery);
    siblingQuery.where.mockReturnValue(siblingQuery);
    const claimsUpdate = updateQuery();
    const sessionUpdate = updateQuery();
    const worktreeUpdate = updateQuery([{ id: "worktree-1" }]);
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi
        .fn()
        .mockReturnValueOnce(sessionQuery)
        .mockReturnValueOnce(siblingQuery),
      update: vi
        .fn()
        .mockReturnValueOnce(claimsUpdate)
        .mockReturnValueOnce(sessionUpdate)
        .mockReturnValueOnce(worktreeUpdate),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await expect(
      closeCliAgentSession({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({ status: "closed", worktreeDiscarded: true });
    expect(claimsUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
    expect(sessionUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
    expect(worktreeUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "discarded" }),
    );
  });

  it("uses a finite lease for stale-session cleanup", () => {
    expect(CLI_SESSION_STALE_AFTER_MS).toBeGreaterThan(0);
    expect(CLI_SESSION_STALE_AFTER_MS).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });
});

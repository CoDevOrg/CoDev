import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./credentials", () => ({
  saveProviderCredential: vi.fn(),
  deleteProviderCredential: vi.fn(),
}));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));
vi.mock("./observability", () => ({ logEvent: vi.fn() }));

/**
 * A single-row stand-in for the `claude_connection_sessions` table. The module
 * only ever touches one session at a time, so the fake ignores drizzle's
 * opaque `where(...)` objects and operates on that row.
 */
let row: Record<string, unknown> | null;

const fakeDb = {
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        row = {
          id: "session-1",
          runnerId: null,
          authorizeUrl: null,
          failureReason: null,
          completedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          ...values,
        };
        return [row];
      },
    }),
  }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      // Apply on `.where(...)` so updates land whether or not the caller
      // chains `.returning()`.
      where: () => {
        row = { ...(row ?? {}), ...patch };
        return { returning: async () => [row] };
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => (row ? [row] : []) }),
    }),
  }),
  delete: () => ({
    where: async () => {
      row = null;
    },
  }),
};

vi.mock("./database", () => ({ getDatabase: () => fakeDb }));

import { saveProviderCredential } from "./credentials";
import {
  cancelClaudeConnectionSession,
  getClaudeConnectionSession,
  reapExpiredClaudeConnectionSessions,
  startClaudeConnectionSession,
  submitClaudeConnectionCode,
  unavailableClaudeRunner,
  type ClaudeLoginRunner,
} from "./claude-connection-session";

function fakeRunner(
  overrides: Partial<ClaudeLoginRunner> = {},
): ClaudeLoginRunner {
  return {
    start: vi.fn(async () => ({
      runnerId: "runner-1",
      authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
    })),
    submitCode: vi.fn(async () => undefined),
    poll: vi.fn(async () => ({ status: "pending" as const })),
    dispose: vi.fn(async () => undefined),
    retain: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  row = null;
  vi.mocked(saveProviderCredential).mockReset();
});

describe("startClaudeConnectionSession", () => {
  it("starts the runner and advances to awaiting_code", async () => {
    const runner = fakeRunner();
    const view = await startClaudeConnectionSession({ userId: "u1" }, runner);
    expect(runner.start).toHaveBeenCalledOnce();
    expect(view.status).toBe("awaiting_code");
    expect(view.authorizeUrl).toContain("oauth/authorize");
  });

  it("marks the session failed when the runner cannot start", async () => {
    const runner = fakeRunner({
      start: vi.fn(async () => {
        throw new Error("no capacity");
      }),
    });
    await expect(
      startClaudeConnectionSession({ userId: "u1" }, runner),
    ).rejects.toThrow(/Unable to start official Claude login/);
    expect(row?.status).toBe("failed");
  });
});

describe("submitClaudeConnectionCode", () => {
  it("feeds the code to the runner and moves to exchanging", async () => {
    const runner = fakeRunner();
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await submitClaudeConnectionCode(
      { userId: "u1", sessionId: "session-1", code: " abc#state " },
      runner,
    );
    expect(runner.submitCode).toHaveBeenCalledWith({
      runnerId: "runner-1",
      code: "abc#state",
    });
    expect(view.status).toBe("exchanging");
  });

  it("rejects a blank code", async () => {
    const runner = fakeRunner();
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    await expect(
      submitClaudeConnectionCode(
        { userId: "u1", sessionId: "session-1", code: "   " },
        runner,
      ),
    ).rejects.toThrow(/code is required/);
  });
});

describe("cancelClaudeConnectionSession", () => {
  it("disposes the runner and marks the attempt canceled", async () => {
    const runner = fakeRunner();
    await startClaudeConnectionSession({ userId: "u1" }, runner);

    const view = await cancelClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
    );

    expect(runner.dispose).toHaveBeenCalledWith({ runnerId: "runner-1" });
    expect(view).toMatchObject({
      status: "failed",
      failureReason: "Connection attempt canceled.",
    });
  });
});

describe("reapExpiredClaudeConnectionSessions", () => {
  it("disposes and removes an expired runner", async () => {
    const runner = fakeRunner();
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    if (row) row.expiresAt = new Date(Date.now() - 1_000);

    await expect(reapExpiredClaudeConnectionSessions(runner)).resolves.toEqual({
      cleaned: 1,
      failures: 0,
    });
    expect(runner.dispose).toHaveBeenCalledWith({ runnerId: "runner-1" });
    expect(row).toBeNull();
  });
});

describe("getClaudeConnectionSession", () => {
  it("retains the runtime without persisting credentials on a ready poll", async () => {
    const runner = fakeRunner({
      poll: vi.fn(async () => ({
        status: "ready" as const,
      })),
    });
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await getClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
    );
    expect(view.status).toBe("connected");
    expect(saveProviderCredential).not.toHaveBeenCalled();
    expect(runner.retain).toHaveBeenCalledWith({ runnerId: "runner-1" });
    expect(runner.dispose).not.toHaveBeenCalled();
    expect(view.authorizeUrl).toBeNull();
    expect(view).not.toHaveProperty("runnerId");
  });

  it("fails safely when the profile cannot be retained", async () => {
    const runner = fakeRunner({
      poll: vi.fn(async () => ({
        status: "ready" as const,
      })),
      retain: vi.fn(async () => {
        throw new Error("private runtime error");
      }),
    });
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await getClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
    );
    expect(view.status).toBe("failed");
    expect(view.failureReason).not.toContain("private runtime error");
    expect(saveProviderCredential).not.toHaveBeenCalled();
    expect(runner.dispose).toHaveBeenCalled();
  });

  it("fails the session on a failed poll", async () => {
    const runner = fakeRunner({
      poll: vi.fn(async () => ({
        status: "failed" as const,
        reason: "user denied",
      })),
    });
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await getClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
    );
    expect(view.status).toBe("failed");
    expect(view.failureReason).toBe("user denied");
    expect(saveProviderCredential).not.toHaveBeenCalled();
  });
});

describe("unavailableClaudeRunner", () => {
  it("refuses to start with a 503", async () => {
    await expect(
      unavailableClaudeRunner.start({ sessionId: "s" }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./credentials", () => ({ saveProviderCredential: vi.fn() }));
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
  delete: () => ({ where: async () => undefined }),
};

vi.mock("./database", () => ({ getDatabase: () => fakeDb }));

import { saveProviderCredential } from "./credentials";
import {
  getClaudeConnectionSession,
  startClaudeConnectionSession,
  submitClaudeConnectionCode,
  unavailableClaudeRunner,
  type ClaudeSetupTokenRunner,
} from "./claude-connection-session";

const TOKEN = "sk-ant-oat01-abc123XYZ_-4567890";

function fakeRunner(
  overrides: Partial<ClaudeSetupTokenRunner> = {},
): ClaudeSetupTokenRunner {
  return {
    start: vi.fn(async () => ({
      runnerId: "runner-1",
      authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
    })),
    submitCode: vi.fn(async () => undefined),
    poll: vi.fn(async () => ({ status: "pending" as const })),
    dispose: vi.fn(async () => undefined),
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
    ).rejects.toThrow(/no capacity/);
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

describe("getClaudeConnectionSession", () => {
  it("persists the token and connects on a ready poll", async () => {
    const runner = fakeRunner({
      poll: vi.fn(async () => ({
        status: "ready" as const,
        oauthToken: TOKEN,
      })),
    });
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await getClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
      async () => {},
    );
    expect(view.status).toBe("connected");
    expect(saveProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", accessToken: TOKEN }),
    );
    expect(runner.dispose).toHaveBeenCalled();
  });

  it("fails the session when the health check rejects the token", async () => {
    const runner = fakeRunner({
      poll: vi.fn(async () => ({
        status: "ready" as const,
        oauthToken: TOKEN,
      })),
    });
    await startClaudeConnectionSession({ userId: "u1" }, runner);
    const view = await getClaudeConnectionSession(
      { userId: "u1", sessionId: "session-1" },
      runner,
      async () => {
        throw new Error(
          "Anthropic rejected the connected account for inference.",
        );
      },
    );
    expect(view.status).toBe("failed");
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runs: vi.fn(),
  sessions: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("./superset-runs", () => ({
  listGen2SupersetRuns: (...args: unknown[]) => mocks.runs(...args),
}));
vi.mock("./agent-sessions", () => ({
  listGen2AgentSessions: (...args: unknown[]) => mocks.sessions(...args),
}));
vi.mock("./agent-coordination-feature", () => ({
  isGen2AgentCoordinationEnabled: (...args: unknown[]) =>
    mocks.enabled(...args),
}));

import {
  findPossibleDuplicateTask,
  tasksLookAlike,
} from "./duplicate-task-check";

const RUN = "11111111-1111-4111-8111-111111111111";
const SARA = "33333333-3333-4333-8333-333333333333";

function activeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN,
    chatId: "chat-other",
    sessionId: "session-1",
    worktreeId: "fix-auth",
    provider: "claude",
    createdBy: SARA,
    status: "running",
    ...overrides,
  };
}

describe("tasksLookAlike", () => {
  it.each([
    [
      "Fix the token refresh bug in the auth middleware",
      "auth middleware token refresh is broken, please fix",
      true,
    ],
    ["Harden login against brute force", "Add rate limiting to login", false],
    ["Update the README", "Update the changelog", false],
    ["fix login", "fix login", false],
  ])("%p vs %p → %p", (left, right, expected) => {
    expect(tasksLookAlike(left, right)).toBe(expected);
  });

  it("compares the member's words, not mention tokens or a leading command", () => {
    const mention =
      "@[Fix login flow token refresh](chat:55555555-5555-4555-8555-555555555555)";
    // Only the mentions and the command overlap.
    expect(
      tasksLookAlike(
        `/plan Write docs for ${mention}`,
        `/plan Benchmark the queue like ${mention}`,
      ),
    ).toBe(false);
    // A stored task's mention label does not match the new prompt's words.
    expect(
      tasksLookAlike("Fix the login flow token refresh", `Review ${mention}`),
    ).toBe(false);
  });
});

describe("findPossibleDuplicateTask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.sessions.mockResolvedValue([
      { id: "session-1", task: "Fix the token refresh bug in auth middleware" },
    ]);
  });

  const input = {
    workspaceId: "workspace-1",
    chatId: "chat-mine",
    prompt: "The auth middleware token refresh bug needs a fix",
  };

  it("returns the matching active session from another chat", async () => {
    mocks.runs.mockResolvedValue([activeRun()]);

    expect(await findPossibleDuplicateTask(input)).toEqual({
      runId: RUN,
      worktreeId: "fix-auth",
      provider: "claude",
      createdBy: SARA,
      status: "running",
      task: "Fix the token refresh bug in auth middleware",
    });
  });

  it.each([
    ["finished runs", { status: "finished" }],
    ["the same chat", { chatId: "chat-mine" }],
    ["runs without a task", { sessionId: null }],
  ])("ignores %s", async (_, overrides) => {
    mocks.runs.mockResolvedValue([activeRun(overrides)]);

    expect(await findPossibleDuplicateTask(input)).toBeUndefined();
  });

  it("shows the matched task with mentions as @labels and no command", async () => {
    mocks.sessions.mockResolvedValue([
      {
        id: "session-1",
        task: "/plan Fix the token refresh bug in auth middleware per @[Auth notes](chat:55555555-5555-4555-8555-555555555555)",
      },
    ]);
    mocks.runs.mockResolvedValue([activeRun()]);

    expect((await findPossibleDuplicateTask(input))?.task).toBe(
      "Fix the token refresh bug in auth middleware per @Auth notes",
    );
  });

  it("is off unless coordination is enabled, and fails open", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await findPossibleDuplicateTask(input)).toBeUndefined();
    expect(mocks.runs).not.toHaveBeenCalled();

    mocks.enabled.mockReturnValue(true);
    mocks.runs.mockRejectedValue(new Error("database unavailable"));
    expect(await findPossibleDuplicateTask(input)).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  requirePlan: vi.fn(),
  start: vi.fn(),
  input: vi.fn(),
  resize: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  supersetStart: vi.fn(),
  supersetInput: vi.fn(),
  supersetResize: vi.fn(),
  supersetPoll: vi.fn(),
  supersetClose: vi.fn(),
}));

vi.mock("../billing/gate", () => ({
  requireWorkspaceOwnerPlan: (...args: unknown[]) => mocks.requirePlan(...args),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

vi.mock("../runtime/orchestrator-terminals", () => ({
  startSandboxTerminal: (...args: unknown[]) => mocks.start(...args),
  sendSandboxTerminalInput: (...args: unknown[]) => mocks.input(...args),
  resizeSandboxTerminal: (...args: unknown[]) => mocks.resize(...args),
  pollSandboxTerminal: (...args: unknown[]) => mocks.poll(...args),
  closeSandboxTerminal: (...args: unknown[]) => mocks.close(...args),
}));

vi.mock("../runtime/orchestrator-superset-runtime", () => ({
  startSupersetTerminal: (...args: unknown[]) => mocks.supersetStart(...args),
  sendSupersetTerminalInput: (...args: unknown[]) =>
    mocks.supersetInput(...args),
  resizeSupersetTerminal: (...args: unknown[]) => mocks.supersetResize(...args),
  pollSupersetTerminal: (...args: unknown[]) => mocks.supersetPoll(...args),
  closeSupersetTerminal: (...args: unknown[]) => mocks.supersetClose(...args),
}));

const {
  clearGen2TerminalMemberCache,
  closeGen2Terminal,
  pollGen2Terminal,
  sendGen2TerminalInput,
  startGen2Terminal,
} = await import("./terminals");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sessionId = "term-1-2";
const originalSupersetRuntime = process.env.CODEV_SUPERSET_RUNTIME_ENABLED;

describe("gen2 terminals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearGen2TerminalMemberCache();
    delete process.env.CODEV_SUPERSET_RUNTIME_ENABLED;
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "ready",
      role: "owner",
    });
  });

  it("checks membership before it reaches the orchestrator", async () => {
    mocks.requireMember.mockRejectedValue(new Error("not a member"));
    await expect(
      pollGen2Terminal(workspaceId, userId, sessionId, 0),
    ).rejects.toThrow("not a member");
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it("requires a running instance only to open a terminal", async () => {
    // start_terminal waits for Codex to go idle in the guest; input, resize,
    // poll and close do not, which is why a terminal opened before a turn
    // keeps streaming through it.
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "stopped",
      role: "owner",
    });
    await expect(
      startGen2Terminal(workspaceId, userId, { rows: 24, columns: 80 }),
    ).rejects.toThrow(/Start the instance/);
    expect(mocks.start).not.toHaveBeenCalled();

    mocks.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
    });
    await expect(
      pollGen2Terminal(workspaceId, userId, sessionId, 0),
    ).resolves.toMatchObject({ exited: true });
    await expect(
      closeGen2Terminal(workspaceId, userId, sessionId),
    ).resolves.toBeUndefined();
  });

  it("is blocked when the workspace owner has no plan", async () => {
    mocks.requirePlan.mockRejectedValue(new Error("subscription_required"));
    await expect(
      startGen2Terminal(workspaceId, userId, { rows: 24, columns: 80 }),
    ).rejects.toThrow("subscription_required");
    await expect(
      sendGen2TerminalInput(workspaceId, userId, sessionId, "ls\n"),
    ).rejects.toThrow("subscription_required");
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.requirePlan).toHaveBeenCalledWith(workspaceId);
  });

  it("passes the session and cursor straight through", async () => {
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 3, data: "hi" }],
      nextSequence: 4,
      exited: false,
      exitCode: null,
    });
    await pollGen2Terminal(workspaceId, userId, sessionId, 3);
    expect(mocks.poll).toHaveBeenCalledWith(workspaceId, sessionId, 3);
    await sendGen2TerminalInput(workspaceId, userId, sessionId, "ls\n");
    expect(mocks.input).toHaveBeenCalledWith(workspaceId, sessionId, "ls\n");
  });

  it("uses the Superset terminal lifecycle when the runtime flag is enabled", async () => {
    process.env.CODEV_SUPERSET_RUNTIME_ENABLED = "true";
    mocks.supersetStart.mockResolvedValue(sessionId);
    await expect(
      startGen2Terminal(workspaceId, userId, { rows: 24, columns: 80 }),
    ).resolves.toBe(sessionId);
    expect(mocks.supersetStart).toHaveBeenCalledWith(workspaceId, {
      worktreeId: "main",
      rows: 24,
      columns: 80,
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  if (originalSupersetRuntime === undefined) {
    delete process.env.CODEV_SUPERSET_RUNTIME_ENABLED;
  } else {
    process.env.CODEV_SUPERSET_RUNTIME_ENABLED = originalSupersetRuntime;
  }
});

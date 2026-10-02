import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../billing/gate", () => ({
  requireWorkspaceOwnerPlan: async () => undefined,
}));

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  resolveCredential: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  register: vi.fn(),
  claimLease: vi.fn(),
  releaseLease: vi.fn(),
  markStarted: vi.fn(),
  markFinished: vi.fn(),
  markFailed: vi.fn(),
  markStopping: vi.fn(),
  markRecoveryRequired: vi.fn(),
  getRunById: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  stop: vi.fn(),
  sendInput: vi.fn(),
  checkRecovery: vi.fn(),
  requireChat: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  listWorktrees: vi.fn(),
  createWorktree: vi.fn(),
  createTurn: vi.fn(),
  recordOutput: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

vi.mock("../providers/credential-seat", () => ({
  waitForCredentialSeat: (...args: unknown[]) => mocks.claim(...args),
  releaseCredentialSeat: (...args: unknown[]) => mocks.release(...args),
  retagCredentialSeat: vi.fn(async () => undefined),
  heartbeatCredentialSeat: vi.fn(async () => undefined),
  describeSeatHolder: () => "a workspace turn is still using this connection.",
}));
vi.mock("./providers", () => ({
  resolveGen2Credential: (...args: unknown[]) =>
    mocks.resolveCredential(...args),
}));

vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.requireChat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.listMessages(...args),
  appendGen2ChatMessage: (...args: unknown[]) => mocks.appendMessage(...args),
}));

vi.mock("../runtime/orchestrator-superset-runtime", () => ({
  listSupersetWorktrees: (...args: unknown[]) => mocks.listWorktrees(...args),
  createSupersetWorktree: (...args: unknown[]) => mocks.createWorktree(...args),
}));

vi.mock("./turns", () => ({
  createGen2Turn: (...args: unknown[]) => mocks.createTurn(...args),
  recordGen2SupersetRunOutput: (...args: unknown[]) =>
    mocks.recordOutput(...args),
}));

vi.mock("./superset-runs", () => ({
  registerGen2SupersetRun: (...args: unknown[]) => mocks.register(...args),
  claimGen2SupersetRunLease: (...args: unknown[]) => mocks.claimLease(...args),
  releaseGen2SupersetRunLease: (...args: unknown[]) =>
    mocks.releaseLease(...args),
  markGen2SupersetRunStarted: (...args: unknown[]) =>
    mocks.markStarted(...args),
  markGen2SupersetRunFinished: (...args: unknown[]) =>
    mocks.markFinished(...args),
  markGen2SupersetRunFailed: (...args: unknown[]) => mocks.markFailed(...args),
  markGen2SupersetRunStopping: (...args: unknown[]) =>
    mocks.markStopping(...args),
  markGen2SupersetRunRecoveryRequired: (...args: unknown[]) =>
    mocks.markRecoveryRequired(...args),
  getGen2SupersetRunById: (...args: unknown[]) => mocks.getRunById(...args),
}));

vi.mock("./superset-agent-orchestrator-client", () => ({
  startSupersetAgent: (...args: unknown[]) => mocks.start(...args),
  pollSupersetAgent: (...args: unknown[]) => mocks.poll(...args),
  stopSupersetAgent: (...args: unknown[]) => mocks.stop(...args),
  sendSupersetAgentInput: (...args: unknown[]) => mocks.sendInput(...args),
  checkSupersetAgentRecovery: (...args: unknown[]) =>
    mocks.checkRecovery(...args),
}));

import { Gen2LifecycleError } from "./errors";
import {
  cancelGen2SupersetAgentSession,
  cancelGen2SupersetAgentTurn,
  pollGen2SupersetAgentSession,
  pollGen2SupersetAgentTurn,
  reconcileGen2SupersetAgentSession,
  startGen2SupersetAgentSession,
  startGen2SupersetAgentTurn,
} from "./superset-agent-runtime";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const credentialId = "44444444-4444-4444-8444-444444444444";
const chatId = "55555555-5555-4555-8555-555555555555";

const RUN = {
  id: runId,
  workspaceId,
  hostAgentSessionId: "agent-1",
  connectionId: credentialId,
  leaseClaimed: true,
};

describe("gen2 Superset agent runtime adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    mocks.requireMember.mockResolvedValue({ status: "ready" });
    mocks.claim.mockResolvedValue({ held: true });
    mocks.resolveCredential.mockResolvedValue({
      credentialId,
      launchProfile: { files: [], env: {} },
      via: "subscription",
    });
    mocks.requireChat.mockResolvedValue({ id: chatId });
    mocks.listMessages.mockResolvedValue([]);
    mocks.listWorktrees.mockResolvedValue([]);
    mocks.createWorktree.mockResolvedValue({
      worktreeId: "agent-chat",
      branch: "codev/agent-chat",
    });
  });

  it("refuses every call while the flag is off", async () => {
    delete process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED;
    await expect(
      startGen2SupersetAgentSession({
        workspaceId,
        userId,
        worktreeId: "main",
        provider: "codex",
        command: ["codex"],
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow(Gen2LifecycleError);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("claims a lease, starts the run, and records host identifiers", async () => {
    mocks.register.mockResolvedValue({
      runId,
      status: "creating",
      created: true,
    });
    mocks.start.mockResolvedValue({
      hostWorkspaceId: "host-ws-1",
      hostTerminalId: "term-1",
      hostAgentSessionId: "agent-1",
    });

    const result = await startGen2SupersetAgentSession({
      workspaceId,
      userId,
      worktreeId: "main",
      provider: "codex",
      command: ["codex", "exec"],
      idempotencyKey: "key-1",
    });

    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId, surface: "gen2" }),
    );
    expect(mocks.claimLease).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
    expect(mocks.markStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId, hostAgentSessionId: "agent-1" }),
    );
    expect(result).toEqual({ runId, status: "running", created: true });
  });

  it("reattaches to an in-flight run instead of starting a second one", async () => {
    mocks.register.mockResolvedValue({
      runId,
      status: "running",
      created: false,
    });

    await startGen2SupersetAgentSession({
      workspaceId,
      userId,
      worktreeId: "main",
      provider: "codex",
      command: ["codex"],
      idempotencyKey: "key-1",
    });

    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("fails the run rather than sharing a busy subscription", async () => {
    // This used to swallow the busy result and launch anyway, putting two
    // turns on one seat while the credential was stamped unavailable.
    mocks.register.mockResolvedValue({
      runId,
      status: "creating",
      created: true,
    });
    mocks.claim.mockResolvedValue({ held: false, holder: null });

    await expect(
      startGen2SupersetAgentSession({
        workspaceId,
        userId,
        worktreeId: "main",
        provider: "codex",
        command: ["codex"],
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow(/still using this connection/);

    expect(mocks.claimLease).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalled();
  });

  it("rolls back the lease and marks the run failed when the launch fails", async () => {
    mocks.register.mockResolvedValue({
      runId,
      status: "creating",
      created: true,
    });
    mocks.start.mockRejectedValue(new Error("launch exploded"));

    await expect(
      startGen2SupersetAgentSession({
        workspaceId,
        userId,
        worktreeId: "main",
        provider: "codex",
        command: ["codex"],
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow("launch exploded");

    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
    expect(mocks.releaseLease).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
    expect(mocks.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ runId, lastError: "launch exploded" }),
    );
  });

  it("marks the run finished and releases the lease once it exits", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 5,
      exited: true,
      exitCode: 0,
      refreshReady: true,
    });

    await pollGen2SupersetAgentSession({
      workspaceId,
      userId,
      runId,
      after: 0,
    });

    expect(mocks.markFinished).toHaveBeenCalledWith(
      expect.objectContaining({ runId, exitReason: "completed" }),
    );
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
    expect(mocks.releaseLease).toHaveBeenCalled();
  });

  it("does not finish the run while it is still running", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 5,
      exited: false,
      exitCode: null,
      refreshReady: false,
    });

    await pollGen2SupersetAgentSession({
      workspaceId,
      userId,
      runId,
      after: 0,
    });

    expect(mocks.markFinished).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });

  it("rejects a run id from a different workspace instead of leaking it", async () => {
    mocks.getRunById.mockResolvedValue({
      ...RUN,
      workspaceId: "other-workspace",
    });

    await expect(
      pollGen2SupersetAgentSession({ workspaceId, userId, runId, after: 0 }),
    ).rejects.toThrow("Superset run not found.");
  });

  it("stops the host process and releases the lease on cancel, even if stop fails", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.stop.mockRejectedValue(new Error("host unreachable"));

    await expect(
      cancelGen2SupersetAgentSession({ workspaceId, userId, runId }),
    ).rejects.toThrow("host unreachable");

    expect(mocks.markStopping).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
    expect(mocks.releaseLease).toHaveBeenCalled();
    expect(mocks.markFinished).toHaveBeenCalledWith(
      expect.objectContaining({ runId, exitReason: "cancelled" }),
    );
  });

  it("marks recovery_required when the host cannot verify the run", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.checkRecovery.mockResolvedValue({ adoptable: false });

    const result = await reconcileGen2SupersetAgentSession({
      workspaceId,
      userId,
      runId,
    });

    expect(result).toEqual({ adoptable: false });
    expect(mocks.markRecoveryRequired).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
  });

  it("leaves an adoptable run alone", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.checkRecovery.mockResolvedValue({ adoptable: true });

    await reconcileGen2SupersetAgentSession({ workspaceId, userId, runId });

    expect(mocks.markRecoveryRequired).not.toHaveBeenCalled();
  });
});

describe("gen2 Superset agent turn (Phase 4 browser-facing delegate)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    mocks.requireMember.mockResolvedValue({ status: "ready" });
    mocks.claim.mockResolvedValue({ held: true });
    mocks.resolveCredential.mockResolvedValue({
      credentialId,
      launchProfile: { files: [], env: {} },
      via: "subscription",
    });
    mocks.requireChat.mockResolvedValue({ id: chatId });
    mocks.listMessages.mockResolvedValue([]);
    mocks.listWorktrees.mockResolvedValue([]);
    mocks.createWorktree.mockResolvedValue({
      worktreeId: "agent-chat",
      branch: "codev/agent-chat",
    });
    mocks.getRunById.mockResolvedValue({
      id: runId,
      workspaceId,
      hostAgentSessionId: "agent-1",
      connectionId: credentialId,
      leaseClaimed: true,
    });
  });

  it("provisions a per-chat worktree, starts the run, and persists the prompt", async () => {
    mocks.register.mockResolvedValue({
      runId,
      status: "creating",
      created: true,
    });
    mocks.start.mockResolvedValue({
      hostWorkspaceId: "host-ws-1",
      hostTerminalId: "term-1",
      hostAgentSessionId: "agent-1",
    });

    const result = await startGen2SupersetAgentTurn({
      workspaceId,
      userId,
      chatId,
      prompt: "hello",
      provider: "codex",
      idempotencyKey: "key-1",
    });

    expect(result).toEqual({ sessionId: runId });
    expect(mocks.createWorktree).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({ worktreeId: expect.any(String) }),
    );
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: expect.any(String) }),
    );
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        role: "user",
        body: "hello",
      }),
    );
    expect(mocks.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: runId, chatId, workspaceId }),
    );
  });

  it("reuses an existing chat worktree instead of creating a second one", async () => {
    mocks.listWorktrees.mockResolvedValue([
      { worktreeId: `agent-${chatId.replace(/-/g, "")}`, branch: "x" },
    ]);
    mocks.register.mockResolvedValue({
      runId,
      status: "creating",
      created: true,
    });
    mocks.start.mockResolvedValue({
      hostWorkspaceId: "host-ws-1",
      hostTerminalId: "term-1",
      hostAgentSessionId: "agent-1",
    });

    await startGen2SupersetAgentTurn({
      workspaceId,
      userId,
      chatId,
      prompt: "hello",
      provider: "codex",
      idempotencyKey: "key-1",
    });

    expect(mocks.createWorktree).not.toHaveBeenCalled();
  });

  it("polls the run, records output, and reports the persisted reply", async () => {
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 1, data: "hi" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      refreshReady: true,
    });
    mocks.recordOutput.mockResolvedValue({
      reply: "hi there",
      messageId: "msg-1",
    });

    const result = await pollGen2SupersetAgentTurn({
      workspaceId,
      userId,
      sessionId: runId,
      after: 0,
    });

    expect(mocks.recordOutput).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: runId, exited: true }),
    );
    expect(result.reply).toBe("hi there");
    expect(result.persistedMessageId).toBe("msg-1");
    expect(result.chunks).toEqual([
      { sequence: 0, dataBase64: Buffer.from("hi").toString("base64") },
    ]);
  });

  it("cancels through the run id", async () => {
    await cancelGen2SupersetAgentTurn({
      workspaceId,
      userId,
      sessionId: runId,
    });

    expect(mocks.markStopping).toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith(workspaceId, "agent-1");
  });
});

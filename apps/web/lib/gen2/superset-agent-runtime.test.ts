import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  bill: vi.fn(),
  requireMember: vi.fn(),
  resolveCredential: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  heartbeat: vi.fn(),
  register: vi.fn(),
  claimLease: vi.fn(),
  releaseLease: vi.fn(),
  markStarted: vi.fn(),
  markFinished: vi.fn(),
  markFailed: vi.fn(),
  markStopping: vi.fn(),
  markRecoveryRequired: vi.fn(),
  getRunById: vi.fn(),
  getActiveRunForSession: vi.fn(),
  listMonitorable: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  captureCredential: vi.fn(),
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
  updateAuthCacheIfCurrent: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSession: vi.fn(),
  getAgentSession: vi.fn(),
  models: vi.fn(),
  avoidBlocked: vi.fn(),
  sessionModel: vi.fn(),
}));

vi.mock("../providers/dynamic-models", () => ({
  getDynamicModelsForProvider: (...args: unknown[]) => mocks.models(...args),
}));

vi.mock("./agent-cli-fallback", () => ({
  avoidBlockedCliModel: (...args: unknown[]) => mocks.avoidBlocked(...args),
}));

vi.mock("../billing/gate", () => ({
  requireWorkspaceOwnerPlan: (...args: unknown[]) => mocks.bill(...args),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

vi.mock("../providers/credential-seat", () => ({
  waitForCredentialSeat: (...args: unknown[]) => mocks.claim(...args),
  releaseCredentialSeat: (...args: unknown[]) => mocks.release(...args),
  retagCredentialSeat: vi.fn(async () => undefined),
  heartbeatCredentialSeat: (...args: unknown[]) => mocks.heartbeat(...args),
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

vi.mock("./agent-sessions", () => ({
  createGen2AgentSession: (...args: unknown[]) =>
    mocks.createAgentSession(...args),
  updateGen2AgentSessionStatus: (...args: unknown[]) =>
    mocks.updateAgentSession(...args),
  getGen2AgentSession: (...args: unknown[]) => mocks.getAgentSession(...args),
  getGen2AgentSessionModel: (...args: unknown[]) => mocks.sessionModel(...args),
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
  getActiveGen2SupersetRunForSession: (...args: unknown[]) =>
    mocks.getActiveRunForSession(...args),
  listMonitorableGen2SupersetRuns: (...args: unknown[]) =>
    mocks.listMonitorable(...args),
}));

vi.mock("./superset-agent-orchestrator-client", () => ({
  startSupersetAgent: (...args: unknown[]) => mocks.start(...args),
  pollSupersetAgent: (...args: unknown[]) => mocks.poll(...args),
  captureSupersetAgentCredential: (...args: unknown[]) =>
    mocks.captureCredential(...args),
  stopSupersetAgent: (...args: unknown[]) => mocks.stop(...args),
  sendSupersetAgentInput: (...args: unknown[]) => mocks.sendInput(...args),
  checkSupersetAgentRecovery: (...args: unknown[]) =>
    mocks.checkRecovery(...args),
}));

const cursorAuth = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../providers/cursor-auth-refresh", () => ({
  updateCursorAuthCache: (...args: unknown[]) => cursorAuth.update(...args),
}));

vi.mock("../providers/hosted-codex-subscription-credentials", () => ({
  updateHostedCodexAuthCacheIfCurrent: (...args: unknown[]) =>
    mocks.updateAuthCacheIfCurrent(...args),
}));

import { Gen2LifecycleError } from "./errors";
import {
  cancelGen2SupersetAgentSession,
  cancelGen2SupersetAgentTurn,
  pollGen2SupersetAgentSession,
  pollGen2SupersetAgentTurn,
  reconcileGen2SupersetAgentSession,
  monitorGen2SupersetAgentSessions,
  sendGen2SupersetAgentInput,
  sendGen2AgentSessionFollowUp,
  stopGen2AgentSession,
  restartGen2AgentSession,
  createGen2AgentSessionTask,
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
  createdBy: userId,
  hostAgentSessionId: "agent-1",
  connectionId: credentialId,
  leaseClaimed: true,
  provider: "openai",
  credentialRevision: "2026-10-04T00:00:00.000Z",
};

describe("gen2 Superset agent runtime adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stop.mockResolvedValue(undefined);
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "editor" });
    mocks.bill.mockResolvedValue(undefined);
    mocks.claim.mockResolvedValue({ held: true });
    mocks.resolveCredential.mockResolvedValue({
      credentialId,
      credentialRevision: "2026-10-04T00:00:00.000Z",
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
    mocks.createAgentSession.mockResolvedValue({ id: "session-1" });
    mocks.captureCredential.mockResolvedValue({ authCacheJson: null });
    mocks.updateAuthCacheIfCurrent.mockResolvedValue(true);
    mocks.models.mockResolvedValue([
      { id: "gpt-5.6-luna", label: "Codex" },
      { id: "gpt-5.6-mini", label: "Codex Mini" },
    ]);
    mocks.avoidBlocked.mockImplementation(
      async (_provider: string, model: string) => ({ model, note: null }),
    );
    mocks.sessionModel.mockResolvedValue(null);
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

  it("sends follow-up input and stops through the active logical-session run", async () => {
    mocks.getActiveRunForSession.mockResolvedValue(RUN);
    mocks.getRunById.mockResolvedValue(RUN);

    await sendGen2AgentSessionFollowUp({
      workspaceId,
      userId,
      sessionId: "session-1",
      data: "Continue with the tests.",
    });
    expect(mocks.sendInput).toHaveBeenCalledWith(
      workspaceId,
      "agent-1",
      "Continue with the tests.",
    );

    await stopGen2AgentSession({ workspaceId, userId, sessionId: "session-1" });
    expect(mocks.stop).toHaveBeenCalledWith(workspaceId, "agent-1");
  });

  const restartableSession = () => {
    mocks.getAgentSession.mockResolvedValue({
      id: "session-1",
      workspaceId,
      chatId,
      createdBy: userId,
      task: "Repair the test.",
      worktreeId: "agent-1",
      provider: "openai",
    });
    mocks.getActiveRunForSession.mockResolvedValue(null);
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
  };
  const restart = () =>
    restartGen2AgentSession({ workspaceId, userId, sessionId: "session-1" });
  const restartedModel = () => {
    const command = (mocks.start.mock.calls[0]?.[1] as { command: string[] })
      .command;
    return command[command.indexOf("--model") + 1];
  };

  it("restarts a recovery-required session on the model it last ran on", async () => {
    restartableSession();
    mocks.sessionModel.mockResolvedValue("gpt-5.6-mini");

    await expect(restart()).resolves.toEqual({ runId });
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        worktreeId: "agent-1",
      }),
    );
    expect(mocks.sessionModel).toHaveBeenCalledWith("session-1");
    expect(mocks.models).toHaveBeenCalledWith("codex", userId);
    expect(restartedModel()).toBe("gpt-5.6-mini");
  });

  it("restarts on the restarting member's default when the last model is unavailable", async () => {
    restartableSession();
    mocks.sessionModel.mockResolvedValue("retired-model");

    await restart();

    expect(restartedModel()).toBe("gpt-5.6-luna");
  });

  it("does not queue a restart the workspace CLI cannot run", async () => {
    restartableSession();
    mocks.avoidBlocked.mockResolvedValue({
      model: null,
      note: "Update the workspace to use this model.",
    });

    await expect(restart()).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateAgentSession).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("monitors live runs and renews their seats without browser polling", async () => {
    mocks.listMonitorable.mockResolvedValue([RUN]);
    mocks.checkRecovery.mockResolvedValue({
      adoptable: true,
      status: "running",
    });

    await expect(monitorGen2SupersetAgentSessions()).resolves.toEqual({
      checked: 1,
      running: 1,
      recoveryRequired: 0,
    });
    expect(mocks.heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId, ref: runId }),
    );
  });

  it("marks an unverifiable run recovery-required and releases its seat", async () => {
    mocks.listMonitorable.mockResolvedValue([RUN]);
    mocks.checkRecovery.mockResolvedValue({
      adoptable: false,
      status: "not_found",
    });

    await expect(monitorGen2SupersetAgentSessions()).resolves.toEqual({
      checked: 1,
      running: 0,
      recoveryRequired: 1,
    });
    expect(mocks.markRecoveryRequired).toHaveBeenCalledWith(
      expect.objectContaining({ runId, workspaceId }),
    );
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId, ref: runId }),
    );
  });

  it("rejects a viewer before resolving credentials or creating a run", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "viewer" });
    await expect(
      startGen2SupersetAgentSession({
        workspaceId,
        userId,
        worktreeId: "main",
        provider: "codex",
        command: ["codex"],
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects a billing gate failure before credential or host access", async () => {
    mocks.bill.mockRejectedValue(new Error("Workspace plan required."));
    await expect(
      startGen2SupersetAgentSession({
        workspaceId,
        userId,
        worktreeId: "main",
        provider: "codex",
        command: ["codex"],
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow("Workspace plan required.");
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("hides another editor's run before input, stop, or host poll", async () => {
    mocks.getRunById.mockResolvedValue({ ...RUN, createdBy: "another-user" });
    await expect(
      sendGen2SupersetAgentInput({
        workspaceId,
        userId,
        runId,
        data: "secret",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelGen2SupersetAgentSession({
        workspaceId,
        userId,
        runId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      pollGen2SupersetAgentSession({
        workspaceId,
        userId,
        runId,
        after: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("allows an owner to stop another member's run but not send input", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "owner" });
    mocks.getRunById.mockResolvedValue({ ...RUN, createdBy: "another-user" });
    await expect(
      sendGen2SupersetAgentInput({
        workspaceId,
        userId,
        runId,
        data: "secret",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await cancelGen2SupersetAgentSession({ workspaceId, userId, runId });
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith(workspaceId, "agent-1");
  });

  it("does not let a demoted creator input or read raw output", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "viewer" });
    mocks.getRunById.mockResolvedValue(RUN);
    await expect(
      sendGen2SupersetAgentInput({
        workspaceId,
        userId,
        runId,
        data: "command",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      pollGen2SupersetAgentSession({
        workspaceId,
        userId,
        runId,
        after: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it("denies a removed member before looking up a run or contacting the host", async () => {
    mocks.requireMember.mockRejectedValue(new Error("Workspace not found."));
    await expect(
      pollGen2SupersetAgentSession({
        workspaceId,
        userId,
        runId,
        after: 0,
      }),
    ).rejects.toThrow("Workspace not found.");
    expect(mocks.getRunById).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
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
    expect(mocks.resolveCredential).toHaveBeenCalledWith(userId, "codex");
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialRevision: "2026-10-04T00:00:00.000Z",
      }),
    );
    expect(mocks.claimLease).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
    expect(mocks.markStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId, hostAgentSessionId: "agent-1" }),
    );
    expect(mocks.start).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        codevRunId: runId,
        codevWorkspaceId: workspaceId,
      }),
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
    expect(mocks.captureCredential).toHaveBeenCalledWith(
      workspaceId,
      "agent-1",
    );
  });

  it("returns a Cursor run's refreshed login only to its creator", async () => {
    mocks.getRunById.mockResolvedValue({
      ...RUN,
      provider: "cursor",
      connectionId: null,
      credentialRevision: null,
    });
    mocks.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 5,
      exited: true,
      exitCode: 0,
      refreshReady: true,
    });
    mocks.captureCredential.mockResolvedValue({
      authCacheJson: '{"token":"t"}',
    });

    await pollGen2SupersetAgentSession({
      workspaceId,
      userId,
      runId,
      after: 0,
    });

    expect(mocks.captureCredential).toHaveBeenCalledWith(
      workspaceId,
      "agent-1",
    );
    expect(cursorAuth.update).toHaveBeenCalledWith(
      RUN.createdBy,
      '{"token":"t"}',
    );
    expect(mocks.updateAuthCacheIfCurrent).not.toHaveBeenCalled();
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

  it("keeps the lease when cancellation cannot safely finish", async () => {
    mocks.getRunById.mockResolvedValue(RUN);
    mocks.stop.mockRejectedValue(new Error("host unreachable"));

    await expect(
      cancelGen2SupersetAgentSession({ workspaceId, userId, runId }),
    ).rejects.toThrow("host unreachable");

    expect(mocks.markStopping).toHaveBeenCalled();
    expect(mocks.markRecoveryRequired).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
    expect(mocks.markFinished).not.toHaveBeenCalled();
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
    mocks.stop.mockResolvedValue(undefined);
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "editor" });
    mocks.bill.mockResolvedValue(undefined);
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
    mocks.createAgentSession.mockResolvedValue({ id: "session-1" });
    mocks.getRunById.mockResolvedValue({
      id: runId,
      workspaceId,
      createdBy: userId,
      hostAgentSessionId: "agent-1",
      connectionId: credentialId,
      leaseClaimed: true,
    });
    mocks.models.mockResolvedValue([
      { id: "gpt-5.6-luna", label: "Codex" },
      { id: "gpt-5.6-mini", label: "Codex Mini" },
    ]);
    mocks.avoidBlocked.mockImplementation(
      async (_provider: string, model: string) => ({ model, note: null }),
    );
  });

  const sessionTask = (overrides: { model?: string } = {}) =>
    createGen2AgentSessionTask({
      workspaceId,
      userId,
      chatId,
      task: "Update the tests.",
      provider: "codex",
      idempotencyKey: "key-1",
      ...overrides,
    });

  it("rejects a viewer's agent task before models, credentials, or the host", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "viewer" });

    await expect(sessionTask()).rejects.toMatchObject({ status: 403 });
    expect(mocks.models).not.toHaveBeenCalled();
    expect(mocks.createWorktree).not.toHaveBeenCalled();
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects an agent task on a model the member's catalog does not offer", async () => {
    await expect(sessionTask({ model: "made-up-model" })).rejects.toMatchObject(
      { status: 400 },
    );
    expect(mocks.models).toHaveBeenCalledWith("codex", userId);
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("runs an agent task on the catalog's default model when none is named", async () => {
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

    await sessionTask();

    const command = (mocks.start.mock.calls[0]?.[1] as { command: string[] })
      .command;
    expect(command[command.indexOf("--model") + 1]).toBe("gpt-5.6-luna");
  });

  it("refuses an agent task when the workspace CLI cannot run the model", async () => {
    mocks.avoidBlocked.mockResolvedValue({
      model: null,
      note: "Update the workspace to use this model.",
    });

    await expect(sessionTask({ model: "gpt-5.6-mini" })).rejects.toMatchObject({
      status: 409,
      message: "Update the workspace to use this model.",
    });
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("checks the owner's plan once per turn", async () => {
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
    const turn = {
      workspaceId,
      userId,
      chatId,
      prompt: "hello",
      provider: "codex" as const,
      idempotencyKey: "key-1",
    };

    await startGen2SupersetAgentTurn(turn);
    expect(mocks.bill).toHaveBeenCalledTimes(1);

    mocks.bill.mockClear();
    await startGen2SupersetAgentTurn({ ...turn, verified: true });
    expect(mocks.bill).not.toHaveBeenCalled();
  });

  it("provisions a per-agent worktree, starts the run, and persists the prompt", async () => {
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

    expect(result).toEqual({ sessionId: runId, agentSessionId: "session-1" });
    expect(mocks.createWorktree).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({ worktreeId: expect.any(String) }),
    );
    expect(mocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        createdBy: userId,
        task: "hello",
        workspaceId,
      }),
    );
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        worktreeId: expect.any(String),
      }),
    );
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        role: "user",
        body: "hello",
      }),
    );
    expect(mocks.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: runId,
        chatId,
        workspaceId,
        // Recorded so a restart can rebuild the command on the same model.
        model: "gpt-5.6-luna",
        worktreeId: expect.stringMatching(/^agent-/),
      }),
    );
  });

  it("asks the host to coordinate only runs in a coordination workspace", async () => {
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
    const start = (idempotencyKey: string) =>
      startGen2SupersetAgentTurn({
        workspaceId,
        userId,
        chatId,
        prompt: "hello",
        provider: "codex",
        idempotencyKey,
      });

    await start("key-1");
    expect(mocks.start.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      "coordination",
    );

    vi.stubEnv("CODEV_AGENT_COORDINATION_WORKSPACES", workspaceId);
    try {
      await start("key-2");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(mocks.start.mock.calls.at(-1)?.[1]).toMatchObject({
      coordination: true,
    });
  });

  it("reuses the idempotent start worktree instead of creating a second one", async () => {
    mocks.listWorktrees.mockResolvedValue([
      {
        worktreeId: `agent-${createHash("sha256").update("key-1").digest("hex").slice(0, 40)}`,
        branch: "x",
      },
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

  it("uses distinct worktrees for independent starts in the same chat", async () => {
    mocks.register
      .mockResolvedValueOnce({ runId, status: "creating", created: true })
      .mockResolvedValueOnce({
        runId: "66666666-6666-4666-8666-666666666666",
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
      prompt: "first",
      provider: "codex",
      idempotencyKey: "key-1",
    });
    await startGen2SupersetAgentTurn({
      workspaceId,
      userId,
      chatId,
      prompt: "second",
      provider: "codex",
      idempotencyKey: "key-2",
    });
    const worktrees = mocks.createWorktree.mock.calls.map(
      ([, value]) => (value as { worktreeId: string }).worktreeId,
    );
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).not.toBe(worktrees[1]);
  });

  it("returns logical and process ids when creating an agent task", async () => {
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

    await expect(
      createGen2AgentSessionTask({
        workspaceId,
        userId,
        chatId,
        task: "Update the tests.",
        provider: "codex",
        idempotencyKey: "key-1",
      }),
    ).resolves.toEqual({ sessionId: "session-1", runId });
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

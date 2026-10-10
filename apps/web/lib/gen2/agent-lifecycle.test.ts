import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/dynamic-models", () => ({
  getDynamicModelsForProvider: async () => [
    { id: "gpt-5.6-luna", label: "Codex" },
    { id: "auto", label: "Auto" },
    { id: "sonnet", label: "Sonnet" },
  ],
}));

vi.mock("./cursor-auth-refresh", () => ({ refreshCursorTurnAuth: vi.fn() }));
const superset = vi.hoisted(() => ({
  start: vi.fn(),
  poll: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./superset-agent-runtime", () => ({
  startGen2SupersetAgentTurn: (...args: unknown[]) => superset.start(...args),
  pollGen2SupersetAgentTurn: (...args: unknown[]) => superset.poll(...args),
  cancelGen2SupersetAgentTurn: (...args: unknown[]) => superset.cancel(...args),
}));
const fallback = vi.hoisted(() => ({
  avoid: vi.fn(),
  continueOn: vi.fn(),
  continued: vi.fn(),
}));
vi.mock("./agent-cli-fallback", () => ({
  avoidBlockedCliModel: fallback.avoid,
}));
vi.mock("./agent-cli-continuation", () => ({
  continueOnFallbackModel: fallback.continueOn,
  continuedSessionId: fallback.continued,
}));

vi.mock("../billing/gate", () => ({
  requireWorkspaceOwnerPlan: async () => undefined,
}));

const duplicates = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("./duplicate-task-check", () => ({
  findPossibleDuplicateTask: (...args: unknown[]) => duplicates.find(...args),
}));

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  requireChat: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  resolveHosted: vi.fn(),
  decrypt: vi.fn(),
  updateCache: vi.fn(),
  ensureHostReady: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
  getAgentModel: vi.fn(),
  createTurn: vi.fn(),
  turnProvider: vi.fn(),
  recordChunks: vi.fn(),
  resolveCredential: vi.fn(),
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

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

const chatProvider = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock("./chats", () => ({
  requireGen2Chat: (...args: unknown[]) => mocks.requireChat(...args),
  listGen2ChatMessages: (...args: unknown[]) => mocks.listMessages(...args),
  appendGen2ChatMessage: (...args: unknown[]) => mocks.appendMessage(...args),
  claimGen2ChatProvider: (...args: unknown[]) => chatProvider.claim(...args),
}));

vi.mock("./turns", () => ({
  createGen2Turn: (...args: unknown[]) => mocks.createTurn(...args),
  recordGen2TurnChunks: (...args: unknown[]) => mocks.recordChunks(...args),
  getGen2TurnProvider: (...args: unknown[]) => mocks.turnProvider(...args),
}));

vi.mock("../platform/observability", () => ({
  logEvent: vi.fn(),
}));

vi.mock("../providers/ai-model", () => ({
  getAgentModel: () => mocks.getAgentModel(),
}));

vi.mock("../runtime/orchestrator-health", () => ({
  ensureHostReady: (...args: unknown[]) => mocks.ensureHostReady(...args),
}));

vi.mock("../runtime/orchestrator-codex-exec", () => ({
  startCodexExecInSandbox: (...args: unknown[]) => mocks.start(...args),
  pollCodexExecInSandbox: (...args: unknown[]) => mocks.poll(...args),
  closeCodexExecInSandbox: (...args: unknown[]) => mocks.close(...args),
}));

vi.mock("../providers/hosted-codex-subscription-credentials", () => ({
  // Still exported: the module under test narrows on it when a stored auth
  // cache turns out to be unusable.
  HostedCodexSubscriptionError: class extends Error {
    readonly status = 400;
    readonly code = "hosted_codex_error";
  },
  resolveHostedCodexSubscription: (...args: unknown[]) =>
    mocks.resolveHosted(...args),
  decryptHostedMaterial: (...args: unknown[]) => mocks.decrypt(...args),
  updateHostedCodexAuthCache: (...args: unknown[]) =>
    mocks.updateCache(...args),
}));

import { OrchestratorError } from "../runtime/orchestrator-request";
import {
  buildGen2CodexCommand,
  cancelGen2AgentTurn,
  pollGen2AgentTurn,
  startGen2AgentTurn,
} from "./agent";
import { Gen2LifecycleError } from "./errors";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const chatId = "44444444-4444-4444-8444-444444444444";
const credentialId = "33333333-3333-4333-8333-333333333333";
const AUTH_CACHE = '{"token":"must-not-escape"}';

const turn = {
  provider: "codex" as const,
  workspaceId,
  userId,
  chatId,
  prompt: "List the files",
  idempotencyKey: "turn-1234",
};

const workspaceContext = {
  view: { mode: "ide", inspector: null, terminalOpen: false, narrow: false },
  worktree: {
    id: "main",
    branch: "main",
    changedFiles: 0,
    unsavedEdits: false,
  },
  worktrees: [],
  openFile: null,
  preview: null,
  listeningPorts: null,
  members: [{ login: "octocat", role: "owner" }],
  agents: [],
  excerpts: [],
  previewEnabled: false,
};

const launchedPrompt = () =>
  (mocks.start.mock.calls.at(-1)?.[1] as { command: string[] }).command.at(-1);

describe("gen2 Codex agent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fallback.avoid.mockImplementation(
      async (_provider: string, model: string) => ({ model, note: null }),
    );
    fallback.continueOn.mockResolvedValue(null);
    fallback.continued.mockResolvedValue(null);
    mocks.getAgentModel.mockReturnValue("gpt-5.4");
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "ready",
      role: "owner",
    });
    mocks.requireChat.mockResolvedValue({
      id: chatId,
      title: "New chat",
    });
    mocks.listMessages.mockResolvedValue([]);
    mocks.appendMessage.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      role: "user",
      body: "List the files",
    });
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: credentialId, encryptedMaterial: "enc" },
    });
    mocks.decrypt.mockResolvedValue({ authCacheJson: AUTH_CACHE });
    mocks.claim.mockResolvedValue({ held: true });
    mocks.release.mockResolvedValue(undefined);
    mocks.ensureHostReady.mockResolvedValue(undefined);
    mocks.createTurn.mockResolvedValue(undefined);
    mocks.turnProvider.mockResolvedValue("codex");
    mocks.resolveCredential.mockResolvedValue({
      credentialId: credentialId,
      launchProfile: { files: [], env: {} },
      via: "subscription",
    });
    mocks.recordChunks.mockResolvedValue(null);
    mocks.start.mockResolvedValue("session-1");
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      codexAuthCacheJson: AUTH_CACHE,
    });
    mocks.close.mockResolvedValue(undefined);
    mocks.updateCache.mockResolvedValue(undefined);
  });

  it("blocks viewers from starting native agent turns", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "viewer" });
    await expect(
      startGen2AgentTurn({ ...turn, provider: "cursor" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
  });

  it("runs Codex with full guest access so the inner sandbox can use the shell", () => {
    const command = buildGen2CodexCommand(
      "List the files",
      [],
      "account-model",
    );
    expect(command.slice(0, 12)).toEqual([
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--dangerously-bypass-hook-trust",
      "--skip-git-repo-check",
      "--sandbox",
      "danger-full-access",
      "-c",
      'approval_policy="never"',
      "--model",
    ]);
    expect(command.at(-1)).toMatch(/List the files/);
    expect(command.at(-1)).toMatch(/Do not inspect .*CODEX_HOME/);
    expect(command.at(-1)).toMatch(/\/workspace/);
    expect(command.join("\n")).not.toContain(AUTH_CACHE);
  });

  it("rejects a model outside the connected account catalog before launching a guest", async () => {
    await expect(
      startGen2AgentTurn({ ...turn, model: "not-in-this-plan" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("starts a turn with the personal cache and returns only a session id", async () => {
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(chatProvider.claim).toHaveBeenCalledWith(chatId, turn.provider);
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId, surface: "gen2" }),
    );
    expect(mocks.start).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        idempotencyKey: "turn-1234",
        launchProfile: expect.any(Object),
      }),
    );
    expect(mocks.appendMessage).toHaveBeenCalledWith({
      chatId,
      role: "user",
      body: "List the files",
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("asks the guest to coordinate only turns in a coordination workspace", async () => {
    await startGen2AgentTurn(turn);
    expect(mocks.start.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      "coordination",
    );

    vi.stubEnv("CODEV_AGENT_COORDINATION_WORKSPACES", workspaceId);
    try {
      await startGen2AgentTurn({ ...turn, idempotencyKey: "turn-5678" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(mocks.start.mock.calls.at(-1)?.[1]).toMatchObject({
      coordination: true,
    });
  });

  it("replays this chat's transcript in the next exec prompt", async () => {
    mocks.listMessages.mockResolvedValue([
      { role: "user", body: "hi" },
      { role: "assistant", body: "hello" },
    ]);
    await startGen2AgentTurn(turn);
    const command = mocks.start.mock.calls[0]?.[1] as {
      command: string[];
    };
    expect(command.command.at(-1)).toMatch(/Continue this conversation/);
    expect(command.command.at(-1)).toMatch(/hello/);
    expect(command.command.at(-1)).toMatch(/List the files/);
  });

  it("refuses to start until the instance is ready", async () => {
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "pending",
      role: "owner",
    });
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("asks the member to connect when they have no credential", async () => {
    mocks.resolveCredential.mockRejectedValue(
      new Gen2LifecycleError("Connect ChatGPT or add an OpenAI API key", 409),
    );
    await expect(startGen2AgentTurn(turn)).rejects.toThrow(/Connect ChatGPT/);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("does not claim a seat for an API key", async () => {
    // A seat is a subscription concept. Claiming one for an API key would
    // invent a one-turn-at-a-time limit the provider does not impose.
    mocks.resolveCredential.mockResolvedValue({
      credentialId: null,
      launchProfile: { files: [], env: {} },
      via: "api-key",
    });
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalled();
  });

  it("refuses a turn whose seat another run holds", async () => {
    // This used to start the turn anyway — two turns on one subscription —
    // while still stamping the credential unavailable for sixteen minutes,
    // which did block the member's chat-room replies.
    mocks.claim.mockResolvedValue({ held: false, holder: null });
    await expect(startGen2AgentTurn(turn)).rejects.toThrow(
      /still using this connection/,
    );
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases a fresh claim when start fails", async () => {
    mocks.start.mockRejectedValue(new OrchestratorError("guest down", 500));
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("does not release a seat it never took", async () => {
    mocks.claim.mockResolvedValue({ held: false, holder: null });
    mocks.start.mockRejectedValue(new OrchestratorError("guest down", 500));
    await expect(startGen2AgentTurn(turn)).rejects.toBeInstanceOf(
      Gen2LifecycleError,
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("retries start once after waking a sleeping host", async () => {
    mocks.start
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("session-1");
    await expect(startGen2AgentTurn(turn)).resolves.toEqual({
      sessionId: "session-1",
    });
    expect(mocks.ensureHostReady).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("strips the auth cache from poll results and releases the seat on exit", async () => {
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(result).toEqual({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      reply: null,
      persistedMessageId: null,
      continuedAs: null,
    });
    expect(result).not.toHaveProperty("codexAuthCacheJson");
    expect(mocks.updateCache).toHaveBeenCalledWith(credentialId, AUTH_CACHE);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("opens a server-side turn record so the reply outlives the browser", async () => {
    await startGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      prompt: "List the files",
      provider: "codex",
      idempotencyKey: "idem-0001",
    });
    expect(mocks.createTurn).toHaveBeenCalledWith({
      sessionId: "session-1",
      provider: "codex",
      workspaceId,
      chatId,
      userId,
      model: "gpt-5.6-luna",
      worktreeId: null,
    });
  });

  it("does not touch the Codex seat when a Claude turn exits", async () => {
    mocks.turnProvider.mockResolvedValue("claude");
    await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.updateCache).not.toHaveBeenCalled();
  });

  it("hands every poll's chunks to the accumulator", async () => {
    await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(mocks.recordChunks).toHaveBeenCalledWith({
      sessionId: "session-1",
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      exited: true,
      exitCode: 0,
    });
  });

  it("returns the reply the server persisted on the closing poll", async () => {
    mocks.recordChunks.mockResolvedValue({
      reply: "Here are the files.",
      messageId: "66666666-6666-4666-8666-666666666666",
    });
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(result.reply).toBe("Here are the files.");
    expect(result.persistedMessageId).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
  });

  it("starts a model the live CLI cannot run on its fallback, with a note", async () => {
    fallback.avoid.mockResolvedValue({
      model: "sonnet",
      note: "gpt-5.6-luna needs a newer CLI. Answering with sonnet.",
    });
    const result = await startGen2AgentTurn(turn);
    const launched = mocks.start.mock.calls[0]?.[1] as { command: string[] };
    expect(launched.command).toContain("sonnet");
    expect(mocks.appendMessage.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ role: "user", body: "List the files" }),
      expect.objectContaining({
        role: "assistant",
        body: "gpt-5.6-luna needs a newer CLI. Answering with sonnet.",
      }),
    ]);
    expect(result).toMatchObject({
      sessionId: "session-1",
      fallback: { from: "gpt-5.6-luna", to: "sonnet" },
    });
  });

  it("explains instead of launching when no model on the account can run", async () => {
    fallback.avoid.mockResolvedValue({
      model: null,
      note: "No other model on your account can run here yet.",
    });
    await expect(startGen2AgentTurn(turn)).rejects.toThrow(
      "No other model on your account can run here yet.",
    );
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("re-runs a prompt without repeating it, from the history before it", async () => {
    await startGen2AgentTurn({
      ...turn,
      model: "sonnet",
      continuation: { history: [{ role: "user", body: "earlier" }] },
    });
    expect(fallback.avoid).not.toHaveBeenCalled();
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    const launched = mocks.start.mock.calls[0]?.[1] as { command: string[] };
    expect(launched.command.at(-1)).toMatch(/earlier/);
  });

  it("hands a turn that ended on a too-old CLI to its fallback re-run", async () => {
    const requirement = { observedVersion: "2.1.236", minVersion: "2.1.280" };
    mocks.recordChunks.mockResolvedValue({
      reply: "",
      messageId: null,
      cliRequirement: requirement,
    });
    fallback.continueOn.mockResolvedValue("session-2");
    const result = await pollGen2AgentTurn({
      workspaceId,
      userId,
      chatId,
      sessionId: "session-1",
      after: 0,
    });
    expect(fallback.continueOn).toHaveBeenCalledWith("session-1", requirement);
    expect(result).toMatchObject({ continuedAs: "session-2" });
  });

  it("releases the seat when the turn is gone", async () => {
    mocks.poll.mockRejectedValue(new OrchestratorError("missing", 404));
    await expect(
      pollGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "session-1",
        after: 0,
      }),
    ).rejects.toThrow(/no longer running/);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
  });

  it("closes the exec and releases the seat on cancel", async () => {
    await cancelGen2AgentTurn({
      workspaceId,
      userId,
      sessionId: "session-1",
    });
    expect(mocks.close).toHaveBeenCalledWith(workspaceId, "session-1");
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId }),
    );
  });
  it("starts, polls, and cancels Cursor through guest exec when Superset sessions are enabled", async () => {
    vi.stubEnv("CODEV_SUPERSET_AGENT_SESSIONS_ENABLED", "true");
    mocks.turnProvider.mockResolvedValue("cursor");
    mocks.resolveCredential.mockResolvedValue({
      credentialId: null,
      launchProfile: { files: [], env: {} },
      via: "subscription",
    });
    try {
      await startGen2AgentTurn({
        workspaceId,
        userId,
        chatId,
        prompt: "Say hello",
        idempotencyKey: "cursor-turn-1234",
        provider: "cursor",
      });
      expect(mocks.start).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({
          command: expect.arrayContaining(["cursor-agent", "--print"]),
        }),
      );
      expect(mocks.createTurn).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "cursor" }),
      );
      await pollGen2AgentTurn({
        workspaceId,
        userId,
        chatId,
        sessionId: "session-1",
        after: 0,
      });
      expect(mocks.poll).toHaveBeenCalled();
      await cancelGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "session-1",
      });
      expect(mocks.close).toHaveBeenCalledWith(workspaceId, "session-1");
      expect(mocks.claim).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("moves new Cursor turns to Superset only when Cursor agents are enabled", async () => {
    const runId = "77777777-7777-4777-8777-777777777777";
    vi.stubEnv("CODEV_SUPERSET_AGENT_SESSIONS_ENABLED", "true");
    vi.stubEnv("CODEV_SUPERSET_CURSOR_AGENTS_ENABLED", "true");
    mocks.turnProvider.mockResolvedValue("cursor");
    superset.start.mockResolvedValue({ sessionId: runId, agentSessionId: "s" });
    superset.poll.mockResolvedValue({
      chunks: [],
      nextSequence: 1,
      exited: false,
      exitCode: null,
    });
    try {
      await startGen2AgentTurn({
        workspaceId,
        userId,
        chatId,
        prompt: "Say hello",
        idempotencyKey: "cursor-superset-1",
        provider: "cursor",
      });
      expect(superset.start).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "cursor" }),
      );
      expect(mocks.start).not.toHaveBeenCalled();

      await pollGen2AgentTurn({
        workspaceId,
        userId,
        chatId,
        sessionId: runId,
        after: 0,
      });
      expect(superset.poll).toHaveBeenCalled();
      await cancelGen2AgentTurn({ workspaceId, userId, sessionId: runId });
      expect(superset.cancel).toHaveBeenCalled();

      // A native Cursor turn already in flight keeps the guest path.
      await pollGen2AgentTurn({
        workspaceId,
        userId,
        chatId,
        sessionId: "codex-1-1",
        after: 0,
      });
      expect(mocks.poll).toHaveBeenCalled();
      await cancelGen2AgentTurn({
        workspaceId,
        userId,
        sessionId: "codex-1-1",
      });
      expect(mocks.close).toHaveBeenCalledWith(workspaceId, "codex-1-1");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("records `/goal done` without checking models or running an agent", async () => {
    mocks.listMessages.mockResolvedValue([
      { role: "user", body: "/goal Ship the parser" },
      { role: "assistant", body: "Working on it." },
    ]);
    await expect(
      startGen2AgentTurn({ ...turn, prompt: "/goal done" }),
    ).resolves.toEqual({
      goal: { text: "Ship the parser", status: "achieved", summary: null },
    });
    expect(mocks.appendMessage).toHaveBeenCalledWith({
      chatId,
      role: "user",
      body: "/goal done",
    });
    expect(fallback.avoid).not.toHaveBeenCalled();
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(superset.start).not.toHaveBeenCalled();
    expect(mocks.createTurn).not.toHaveBeenCalled();
  });

  it("refuses a viewer's goal change before touching the chat", async () => {
    mocks.requireMember.mockResolvedValue({ status: "ready", role: "viewer" });
    await expect(
      startGen2AgentTurn({ ...turn, prompt: "/goal clear" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("sets no goal when a `/goal` turn stops at a duplicate warning", async () => {
    duplicates.find.mockResolvedValue({ runId: "run-1", chatTitle: "Other" });
    await expect(
      startGen2AgentTurn({ ...turn, prompt: "/goal Ship the parser" }),
    ).resolves.toEqual({
      possibleDuplicate: { runId: "run-1", chatTitle: "Other" },
    });
    // The goal is read from the persisted prompt, so nothing was written.
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("checks for duplicates by the member's words, not mentions or the command", async () => {
    await startGen2AgentTurn({
      ...turn,
      prompt:
        "/plan Write tests for @[auth.ts](file:src%2Fauth.ts) like @[Fix login flow](chat:55555555-5555-4555-8555-555555555555) did",
    });
    expect(duplicates.find).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        chatId,
        prompt: "Write tests for   like   did",
      }),
    );
    // The agent still gets the prompt as sent.
    expect(launchedPrompt()).toMatch(/@\[Fix login flow\]\(chat:5{8}-/);
  });

  it("gives a turn with the member's view the action protocol and its nonce", async () => {
    const result = await startGen2AgentTurn({ ...turn, workspaceContext });
    expect(result).toMatchObject({
      sessionId: "session-1",
      actionNonce: expect.stringMatching(/^[a-z0-9]{10}$/),
    });
    const prompt = launchedPrompt();
    const { actionNonce } = result as { actionNonce: string };
    expect(prompt).toContain(`\`\`\`codev-action ${actionNonce}`);
    expect(prompt).toContain("- Member role: owner");
    // The member's words stay last, after the marker the fake guest reads.
    expect(prompt?.endsWith("Current request:\nList the files")).toBe(true);
  });

  it("starts a turn whose view does not parse, without actions", async () => {
    const result = await startGen2AgentTurn({
      ...turn,
      workspaceContext: { ...workspaceContext, members: "everyone" },
    });
    expect(result).toEqual({ sessionId: "session-1" });
    expect(launchedPrompt()).not.toContain("codev-action");
  });

  it("re-runs a continuation with its mode but without the protocol", async () => {
    const result = await startGen2AgentTurn({
      ...turn,
      prompt: "/plan Add caching",
      model: "sonnet",
      workspaceContext,
      continuation: { history: [{ role: "user", body: "earlier" }] },
    });
    expect(result).toEqual({ sessionId: "session-1" });
    const prompt = launchedPrompt();
    expect(prompt).toContain("Mode: plan.");
    expect(prompt).not.toContain("codev-action");
    expect(prompt).not.toContain("Workspace view");
  });

  it("hands the Superset path the context, history and nonce it built", async () => {
    vi.stubEnv("CODEV_SUPERSET_AGENT_SESSIONS_ENABLED", "true");
    superset.start.mockImplementation(
      async (input: { actionNonce?: string }) => ({
        sessionId: "run-1",
        agentSessionId: "session-1",
        actionNonce: input.actionNonce,
      }),
    );
    try {
      const result = await startGen2AgentTurn({
        ...turn,
        prompt: "/review",
        workspaceContext,
      });
      const input = superset.start.mock.calls[0]?.[0] as {
        context: string;
        actionNonce: string;
        history: unknown[];
        verified: boolean;
      };
      expect(input.verified).toBe(true);
      expect(input.history).toEqual([]);
      expect(input.actionNonce).toMatch(/^[a-z0-9]{10}$/);
      expect(input.context).toContain(`codev-action ${input.actionNonce}`);
      expect(input.context).toContain("Mode: review.");
      expect(result).toMatchObject({ actionNonce: input.actionNonce });
      expect(mocks.listMessages).toHaveBeenCalledTimes(1);
      expect(mocks.start).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

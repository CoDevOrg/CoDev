import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class OrchestratorError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly conflictPaths: string[] = [],
    ) {
      super(message);
      this.name = "OrchestratorError";
    }
  }
  return {
    OrchestratorError,
    getHostState: vi.fn(),
    getIde: vi.fn(),
    prepareIde: vi.fn(),
    refreshIdeCredentials: vi.fn().mockResolvedValue(undefined),
    requestHostWake: vi.fn(),
    waitForOrchestrator: vi.fn().mockResolvedValue(undefined),
    startIde: vi.fn(),
    stopIde: vi.fn().mockResolvedValue(undefined),
    assertWorkspaceCreditQuota: vi.fn().mockResolvedValue(undefined),
    openOrcaInterval: vi.fn().mockResolvedValue(undefined),
    resolveAgentCredential: vi.fn(),
    resolveWorkspaceApiKey: vi.fn(),
    resolveCursorCliAuth: vi.fn(),
    resolveClaudeCliTokenForIde: vi.fn(),
    resolveHostedCodexSubscription: vi.fn(),
    decryptHostedMaterial: vi.fn(),
  };
});

vi.mock("./host", () => ({
  getHostState: mocks.getHostState,
  requestHostWake: mocks.requestHostWake,
}));
vi.mock("../github/github", () => ({ getGitHubUserToken: vi.fn() }));
vi.mock("../providers/credentials", () => ({
  resolveAgentCredential: mocks.resolveAgentCredential,
  resolveWorkspaceApiKey: mocks.resolveWorkspaceApiKey,
  resolveCursorCliAuth: mocks.resolveCursorCliAuth,
  resolveClaudeCliTokenForIde: mocks.resolveClaudeCliTokenForIde,
}));
vi.mock("../providers/hosted-codex-subscription-credentials", () => ({
  resolveHostedCodexSubscription: mocks.resolveHostedCodexSubscription,
  decryptHostedMaterial: mocks.decryptHostedMaterial,
}));
vi.mock("./orchestrator", () => ({
  OrchestratorError: mocks.OrchestratorError,
  startIde: mocks.startIde,
  prepareIde: mocks.prepareIde,
  refreshIdeCredentials: mocks.refreshIdeCredentials,
  getIde: mocks.getIde,
  stopIde: mocks.stopIde,
  waitForOrchestrator: mocks.waitForOrchestrator,
}));
vi.mock("./quotas", () => ({
  QuotaError: class QuotaError extends Error {},
  assertWorkspaceCreditQuota: mocks.assertWorkspaceCreditQuota,
}));
vi.mock("./compute-credits", () => ({
  openOrcaInterval: mocks.openOrcaInterval,
}));

import {
  ensureOrcaSession,
  OrcaHostError,
  prepareOrcaWorkspace,
} from "./orca-host";
import { RUNTIME_UNAVAILABLE_MESSAGE } from "./runtime-availability";

const workspaceId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
const userId = "5a946afa-6881-44a6-adbd-c1f9fe136881";
const workspace = {
  id: workspaceId,
  repository: null,
  repositoryVisibility: null,
  defaultBranch: null,
};
const readyPayload = {
  type: "orca_server_ready",
  schemaVersion: 1,
  runtimeId: "runtime-1",
  boundEndpoint: null,
  advertisedEndpoint: null,
  pairing: {
    available: true,
    url: "orca://pair?code=abc123",
    endpoint: `https://runtime.example/w/${workspaceId}/pair`,
    deviceId: "device-1",
    webClientUrl: null,
    scope: "runtime" as const,
  },
};
const session = {
  workspaceId,
  port: 5173,
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  ready: readyPayload,
};

describe("ensureOrcaSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `ensureOrcaSession` mints the workspace's coordination MCP token, which
    // is HMAC-signed with AUTH_SECRET — without one, every case here throws
    // before it reaches what it is actually asserting.
    vi.stubEnv("AUTH_SECRET", "o".repeat(40));
    mocks.getHostState.mockResolvedValue("running");
    mocks.requestHostWake.mockResolvedValue("running");
    mocks.getIde.mockRejectedValue(
      new mocks.OrchestratorError("not found", 404),
    );
    mocks.waitForOrchestrator.mockResolvedValue(undefined);
    mocks.stopIde.mockResolvedValue(undefined);
    // Default: nothing linked, so every workspace lookup resolves to nothing —
    // exactly as the real lookups do without a database.
    mocks.resolveAgentCredential.mockRejectedValue(new Error("no credential"));
    mocks.resolveWorkspaceApiKey.mockResolvedValue(null);
    mocks.resolveCursorCliAuth.mockResolvedValue(null);
    mocks.resolveClaudeCliTokenForIde.mockResolvedValue(null);
    mocks.resolveHostedCodexSubscription.mockResolvedValue(null);
    mocks.prepareIde.mockResolvedValue(undefined);
  });

  it("prepares a repository without resolving member agent credentials", async () => {
    const repositoryWorkspace = {
      ...workspace,
      repository: "CoDevOrg/CoDev",
      repositoryVisibility: "public",
      defaultBranch: "main",
    };

    await expect(
      prepareOrcaWorkspace(repositoryWorkspace, userId),
    ).resolves.toBe("prepared");

    expect(mocks.prepareIde).toHaveBeenCalledWith(workspaceId, {
      projectRoot: `/srv/codev/workspaces/${workspaceId}`,
      clone: {
        repository: "CoDevOrg/CoDev",
        defaultBranch: "main",
      },
    });
    expect(mocks.resolveWorkspaceApiKey).not.toHaveBeenCalled();
    expect(mocks.resolveCursorCliAuth).not.toHaveBeenCalled();
    expect(mocks.resolveClaudeCliTokenForIde).not.toHaveBeenCalled();
    expect(mocks.resolveHostedCodexSubscription).not.toHaveBeenCalled();
  });

  it("does not start repository preparation while the host is starting", async () => {
    mocks.requestHostWake.mockResolvedValueOnce("starting");

    await expect(prepareOrcaWorkspace(workspace, userId)).resolves.toBe(
      "host-starting",
    );
    expect(mocks.prepareIde).not.toHaveBeenCalled();
  });

  it("reconnects a live workspace without EC2 discovery while deferring credentials and metering", async () => {
    mocks.getIde.mockResolvedValueOnce(session);
    mocks.startIde.mockResolvedValueOnce(session);
    const result = await ensureOrcaSession(workspace, userId);
    expect(result.state).toBe("ready");
    expect(mocks.assertWorkspaceCreditQuota).toHaveBeenCalledWith(
      workspaceId,
      userId,
    );
    expect(mocks.getIde).toHaveBeenCalledWith(workspaceId, 1_500);
    expect(mocks.getHostState).not.toHaveBeenCalled();
    expect(mocks.requestHostWake).not.toHaveBeenCalled();
    expect(mocks.waitForOrchestrator).not.toHaveBeenCalled();
    expect(mocks.startIde).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({ memberId: userId }),
    );
    expect(mocks.openOrcaInterval).toHaveBeenCalledWith(userId, workspaceId);
    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({ memberId: userId }),
      ),
    );
  });

  it("falls back to waking the host when the bounded session probe times out", async () => {
    mocks.getIde.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    mocks.getHostState.mockResolvedValueOnce("stopped");
    mocks.requestHostWake.mockResolvedValueOnce("starting");
    await expect(ensureOrcaSession(workspace, userId)).resolves.toEqual({
      state: "host-starting",
    });
    expect(mocks.requestHostWake).toHaveBeenCalledOnce();
    expect(mocks.startIde).not.toHaveBeenCalled();
  });

  it("answers host-starting quickly instead of holding the request open", async () => {
    // The client polls this route and shows a 202 as "still booting", so
    // waiting here buys nothing and costs the attempt: the browser's own
    // request timeout fires mid-wait, aborts the fetch, and the next attempt
    // starts over from the session probe. A cold host takes minutes to
    // bootstrap, which no single request was ever going to outlast.
    mocks.getIde.mockRejectedValueOnce(
      new mocks.OrchestratorError("not found", 404),
    );
    mocks.getHostState.mockResolvedValueOnce("stopped");
    mocks.requestHostWake.mockResolvedValueOnce("running");
    mocks.startIde.mockResolvedValueOnce(session);
    await ensureOrcaSession(workspace, userId);

    const orchestratorWaitMs = mocks.waitForOrchestrator.mock.calls.at(-1)?.[0];
    expect(orchestratorWaitMs).toBeGreaterThan(0);
    expect(orchestratorWaitMs).toBeLessThanOrEqual(15_000);
    // A host caught mid-deallocate is the routine case for somebody coming
    // back from a break, and each turn of that wait is an ARM call plus two
    // seconds. Give it a turn or two, then poll.
    const stoppingAttempts = mocks.requestHostWake.mock.calls.at(-1)?.[0];
    expect(stoppingAttempts).toBeGreaterThan(0);
    expect(stoppingAttempts).toBeLessThanOrEqual(3);
  });

  it("does not treat denied runtime access as a reason to wake or start a host", async () => {
    mocks.getIde.mockRejectedValueOnce(
      new mocks.OrchestratorError("forbidden", 403),
    );
    await expect(ensureOrcaSession(workspace, userId)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.getHostState).not.toHaveBeenCalled();
    expect(mocks.startIde).not.toHaveBeenCalled();
  });

  it("does not probe or connect when the workspace quota check fails", async () => {
    mocks.assertWorkspaceCreditQuota.mockRejectedValueOnce(
      new Error("quota unavailable"),
    );
    await expect(ensureOrcaSession(workspace, userId)).rejects.toThrow(
      "quota unavailable",
    );
    expect(mocks.getIde).not.toHaveBeenCalled();
    expect(mocks.startIde).not.toHaveBeenCalled();
  });

  it("does not trust a session returned for a different workspace", async () => {
    mocks.getIde.mockResolvedValueOnce({
      ...session,
      workspaceId: "different",
    });
    mocks.startIde.mockResolvedValueOnce(session);
    await ensureOrcaSession(workspace, userId);
    expect(mocks.getHostState).toHaveBeenCalledOnce();
  });

  it("hydrates a member's workspace-enabled Cursor and OpenAI keys after readiness", async () => {
    mocks.resolveWorkspaceApiKey.mockImplementation(
      async (_userId: string, _workspaceId: string, provider: string) =>
        provider === "cursor"
          ? "key_cursor_abc"
          : provider === "openai"
            ? "sk-openai-xyz"
            : null,
    );
    mocks.startIde.mockResolvedValueOnce(session);

    await ensureOrcaSession(workspace, userId);

    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({
          cursorApiKey: "key_cursor_abc",
          openaiApiKey: "sk-openai-xyz",
        }),
      ),
    );
    expect(mocks.startIde.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({
        cursorApiKey: expect.any(String),
        openaiApiKey: expect.any(String),
      }),
    );
  });

  function hostedCodex(connectedVia: "cli" | "browser") {
    return {
      credential: {
        connectedVia,
        enabledForWorkspace: true,
        encryptedMaterial: "enc",
      },
      source: "USER" as const,
    };
  }

  it("materializes a CLI-connected hosted Codex subscription after readiness", async () => {
    mocks.resolveHostedCodexSubscription.mockResolvedValue(hostedCodex("cli"));
    mocks.decryptHostedMaterial.mockResolvedValue({
      authCacheJson: '{"tokens":{}}',
    });
    mocks.startIde.mockResolvedValueOnce(session);

    await ensureOrcaSession(workspace, userId);

    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({ codexAuthCacheJson: '{"tokens":{}}' }),
      ),
    );
    const input = mocks.refreshIdeCredentials.mock.calls.at(0)?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(input?.openaiApiKey).toBeUndefined();
  });

  it("materializes a browser-connected Codex subscription after readiness", async () => {
    mocks.resolveHostedCodexSubscription.mockResolvedValue(
      hostedCodex("browser"),
    );
    mocks.decryptHostedMaterial.mockResolvedValue({
      authCacheJson: '{"tokens":{}}',
    });
    mocks.startIde.mockResolvedValueOnce(session);

    await ensureOrcaSession(workspace, userId);

    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalled(),
    );
    const input = mocks.refreshIdeCredentials.mock.calls.at(0)?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(input?.codexAuthCacheJson).toBe('{"tokens":{}}');
    expect(mocks.decryptHostedMaterial).toHaveBeenCalledWith("enc");
  });

  it("hydrates a Claude CLI setup-token after readiness, unless an API key wins", async () => {
    mocks.resolveClaudeCliTokenForIde.mockResolvedValue("sk-ant-cli-token");
    mocks.startIde.mockResolvedValueOnce(session);
    await ensureOrcaSession(workspace, userId);
    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({ claudeCodeOauthToken: "sk-ant-cli-token" }),
      ),
    );
    const first = mocks.refreshIdeCredentials.mock.calls.at(0)?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(first?.anthropicApiKey).toBeUndefined();

    mocks.startIde.mockClear();
    mocks.refreshIdeCredentials.mockClear();
    mocks.resolveWorkspaceApiKey.mockImplementation(
      async (_userId: string, _workspaceId: string, provider: string) =>
        provider === "anthropic" ? "sk-ant-api-key" : null,
    );
    mocks.startIde.mockResolvedValueOnce(session);
    await ensureOrcaSession(workspace, userId);
    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalled(),
    );
    const second = mocks.refreshIdeCredentials.mock.calls.at(0)?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(second?.anthropicApiKey).toBe("sk-ant-api-key");
    expect(second?.claudeCodeOauthToken).toBeUndefined();
  });

  it("never passes a personal Claude runtime or legacy subscription token to the shared IDE", async () => {
    mocks.resolveAgentCredential.mockResolvedValue({
      provider: "anthropic",
      source: "USER",
      authType: "CLAUDE_RUNTIME",
      claudeUserId: userId,
      credentialId: "private-connection",
    });
    mocks.startIde.mockResolvedValueOnce(session);
    await ensureOrcaSession(workspace, userId);
    await vi.waitFor(() =>
      expect(mocks.refreshIdeCredentials).toHaveBeenCalled(),
    );
    const input = mocks.refreshIdeCredentials.mock.calls[0]?.[1];
    expect(input?.claudeCodeOauthToken).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain("private-connection");
  });
  it("stops the stale IDE record and retries once after a crashed launch", async () => {
    mocks.startIde
      .mockRejectedValueOnce(
        new mocks.OrchestratorError(
          "Orca IDE process exited before reporting readiness",
          500,
        ),
      )
      .mockResolvedValueOnce(session);

    await expect(ensureOrcaSession(workspace, userId)).resolves.toMatchObject({
      state: "ready",
    });
    expect(mocks.stopIde).toHaveBeenCalledWith(workspaceId);
    expect(mocks.startIde).toHaveBeenCalledTimes(2);
  });

  it("does not retry orchestrator errors unrelated to a crashed launch", async () => {
    mocks.startIde.mockRejectedValueOnce(
      new mocks.OrchestratorError("Sandbox service returned HTTP 503.", 503),
    );

    // A host that is momentarily unavailable is reported as still starting so
    // the client polls into it, rather than as an error over a workspace that
    // is about to work perfectly well.
    await expect(ensureOrcaSession(workspace, userId)).resolves.toMatchObject({
      state: "host-starting",
    });
    expect(mocks.stopIde).not.toHaveBeenCalled();
    expect(mocks.startIde).toHaveBeenCalledTimes(1);
  });

  it("keeps a repeatedly crashing launch on the starting path", async () => {
    const staleError = new mocks.OrchestratorError(
      "Orca IDE process exited before reporting readiness",
      500,
    );
    mocks.startIde
      .mockRejectedValueOnce(staleError)
      .mockRejectedValueOnce(staleError);

    await expect(ensureOrcaSession(workspace, userId)).resolves.toMatchObject({
      state: "host-starting",
    });
    // The stale-record recovery still runs exactly once: the retry is what
    // reclaims a wedged session, and the polling client re-enters this path
    // rather than being shown the crash.
    expect(mocks.stopIde).toHaveBeenCalledTimes(1);
    expect(mocks.startIde).toHaveBeenCalledTimes(2);
  });

  it("still surfaces a quota refusal, which the person can act on", async () => {
    mocks.startIde.mockRejectedValueOnce(
      new mocks.OrchestratorError("Workspace credit exhausted.", 402),
    );

    const result = ensureOrcaSession(workspace, userId);
    await expect(result).rejects.toBeInstanceOf(OrcaHostError);
    await expect(result).rejects.toMatchObject({
      status: 402,
      // Verbatim: being out of credit is the member's own business, and
      // replacing it with the generic runtime line would hide a billing
      // problem behind an infrastructure one.
      message: "Workspace credit exhausted.",
    });
  });

  /**
   * The orchestrator's own text describes CoDev's infrastructure. It used to
   * reach the "Could not open the workspace" panel verbatim on every
   * non-transient status.
   */
  it("does not put orchestrator text in front of a member", async () => {
    mocks.startIde.mockRejectedValueOnce(
      new mocks.OrchestratorError(
        "caddy route reload failed on host i-0abc",
        400,
      ),
    );

    const result = ensureOrcaSession(workspace, userId);
    await expect(result).rejects.toMatchObject({
      status: 400,
      message: RUNTIME_UNAVAILABLE_MESSAGE,
      detail: "caddy route reload failed on host i-0abc",
    });
  });
});

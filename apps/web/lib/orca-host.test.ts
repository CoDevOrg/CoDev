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
    requestHostWake: vi.fn(),
    waitForOrchestrator: vi.fn().mockResolvedValue(undefined),
    startIde: vi.fn(),
    stopIde: vi.fn().mockResolvedValue(undefined),
    assertWorkspaceCreditQuota: vi.fn().mockResolvedValue(undefined),
    openOrcaInterval: vi.fn().mockResolvedValue(undefined),
    resolveAgentCredential: vi.fn(),
  };
});

vi.mock("./host", () => ({
  getHostState: mocks.getHostState,
  requestHostWake: mocks.requestHostWake,
}));
vi.mock("./github", () => ({ getGitHubUserToken: vi.fn() }));
vi.mock("./credentials", () => ({
  resolveAgentCredential: mocks.resolveAgentCredential,
}));
vi.mock("./orchestrator", () => ({
  OrchestratorError: mocks.OrchestratorError,
  startIde: mocks.startIde,
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

import { ensureOrcaSession, OrcaHostError } from "./orca-host";

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
    mocks.getHostState.mockResolvedValue("running");
    mocks.waitForOrchestrator.mockResolvedValue(undefined);
    mocks.stopIde.mockResolvedValue(undefined);
    // Default: nothing linked, so a resolution throws exactly as the real
    // lookup does without a database.
    mocks.resolveAgentCredential.mockRejectedValue(new Error("no credential"));
  });

  it("forwards a member's linked Cursor and plain OpenAI keys to the host", async () => {
    mocks.resolveAgentCredential.mockImplementation(
      async (_userId: string, _workspaceId: string, provider: string) => {
        if (provider === "cursor") {
          return {
            provider,
            authType: "API_KEY",
            apiKeyOrToken: "key_cursor_abc",
          };
        }
        if (provider === "openai") {
          return {
            provider,
            authType: "API_KEY",
            apiKeyOrToken: "sk-openai-xyz",
          };
        }
        throw new Error("no credential");
      },
    );
    mocks.startIde.mockResolvedValueOnce(session);

    await ensureOrcaSession(workspace, userId);

    expect(mocks.startIde).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        cursorApiKey: "key_cursor_abc",
        openaiApiKey: "sk-openai-xyz",
      }),
    );
  });

  it("omits the plain OpenAI key when the member has a hosted Codex subscription", async () => {
    mocks.resolveAgentCredential.mockImplementation(
      async (_userId: string, _workspaceId: string, provider: string) => {
        if (provider === "openai") {
          return {
            provider,
            authType: "HOSTED_CODEX_SUBSCRIPTION",
            codexAuthCacheJson: '{"tokens":{}}',
          };
        }
        throw new Error("no credential");
      },
    );
    mocks.startIde.mockResolvedValueOnce(session);

    await ensureOrcaSession(workspace, userId);

    const [, input] = mocks.startIde.mock.calls[0];
    expect(input.openaiApiKey).toBeUndefined();
    expect(input.codexAuthCacheJson).toBe('{"tokens":{}}');
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
    await expect(result).rejects.toMatchObject({ status: 402 });
  });
});

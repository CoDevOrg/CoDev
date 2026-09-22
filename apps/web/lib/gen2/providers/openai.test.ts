import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  model: vi.fn(),
  resolveCredential: vi.fn(),
  providerStatus: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  resolveHosted: vi.fn(),
  updateCache: vi.fn(),
  ensureHostReady: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../../providers/ai-model", () => ({
  getAgentModel: (...args: unknown[]) => mocks.model(...args),
}));

vi.mock("../../providers/hosted-codex-subscription-credentials", () => ({
  claimHostedCodexExecution: (...args: unknown[]) => mocks.claim(...args),
  releaseHostedCodexExecution: (...args: unknown[]) => mocks.release(...args),
  resolveHostedCodexSubscription: (...args: unknown[]) =>
    mocks.resolveHosted(...args),
  updateHostedCodexAuthCache: (...args: unknown[]) =>
    mocks.updateCache(...args),
}));

vi.mock("../../runtime/orchestrator-health", () => ({
  ensureHostReady: (...args: unknown[]) => mocks.ensureHostReady(...args),
}));

vi.mock("../../runtime/orchestrator-codex-exec", () => ({
  startCodexExecInSandbox: (...args: unknown[]) => mocks.start(...args),
  pollCodexExecInSandbox: (...args: unknown[]) => mocks.poll(...args),
  closeCodexExecInSandbox: (...args: unknown[]) => mocks.close(...args),
}));

vi.mock("../instance", () => ({
  describeGen2RuntimeFailure: (error: unknown) =>
    error instanceof Error ? error.message : "runtime failure",
}));

vi.mock("../providers", () => ({
  getGen2ProviderStatus: (...args: unknown[]) => mocks.providerStatus(...args),
  resolveGen2Codex: (...args: unknown[]) => mocks.resolveCredential(...args),
}));

import { openAiGen2ProviderAdapter } from "./openai";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const authCacheJson = '{"token":"private"}';

describe("OpenAI Gen 2 provider adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.model.mockReturnValue("gpt-5.4");
    mocks.providerStatus.mockResolvedValue({ connected: true, via: "api-key" });
    mocks.resolveCredential.mockResolvedValue({
      credentialId,
      authCacheJson,
      via: "subscription",
    });
    mocks.claim.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    mocks.resolveHosted.mockResolvedValue({ credential: { id: credentialId } });
    mocks.updateCache.mockResolvedValue(undefined);
    mocks.ensureHostReady.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue("session-1");
    mocks.poll.mockResolvedValue({
      chunks: [{ sequence: 0, dataBase64: "e30=" }],
      nextSequence: 1,
      exited: true,
      exitCode: 0,
      codexAuthCacheJson: authCacheJson,
    });
    mocks.close.mockResolvedValue(undefined);
  });

  it("reports redacted readiness from the adapter", async () => {
    await expect(
      openAiGen2ProviderAdapter.getReadiness(userId),
    ).resolves.toMatchObject({
      id: "openai",
      installed: true,
      ready: true,
    });
  });

  it("owns credential resolution and runtime start without exposing auth", async () => {
    await expect(
      openAiGen2ProviderAdapter.start({
        workspaceId,
        userId,
        prompt: "List the files",
        history: [],
        idempotencyKey: "turn-1234",
      }),
    ).resolves.toEqual({ sessionId: "session-1" });
    expect(mocks.claim).toHaveBeenCalledWith(credentialId);
    expect(mocks.start).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        idempotencyKey: "turn-1234",
        codexAuthCacheJson: authCacheJson,
      }),
    );
  });

  it("releases a claimed subscription when start fails", async () => {
    mocks.start.mockRejectedValue(new Error("guest down"));
    await expect(
      openAiGen2ProviderAdapter.start({
        workspaceId,
        userId,
        prompt: "List the files",
        history: [],
        idempotencyKey: "turn-1234",
      }),
    ).rejects.toThrow("guest down");
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
  });

  it("redacts the final auth cache while updating and releasing its owner", async () => {
    const result = await openAiGen2ProviderAdapter.poll({
      workspaceId,
      turnOwnerId: userId,
      sessionId: "session-1",
      after: 0,
    });
    expect(result).not.toHaveProperty("codexAuthCacheJson");
    expect(mocks.updateCache).toHaveBeenCalledWith(credentialId, authCacheJson);
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
  });

  it("releases the initiating member's subscription on cancellation", async () => {
    await openAiGen2ProviderAdapter.cancel({
      workspaceId,
      turnOwnerId: userId,
      sessionId: "session-1",
    });
    expect(mocks.close).toHaveBeenCalledWith(workspaceId, "session-1");
    expect(mocks.release).toHaveBeenCalledWith(credentialId);
  });
});

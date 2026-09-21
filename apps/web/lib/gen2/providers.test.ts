import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHosted: vi.fn(),
  decryptMaterial: vi.fn(),
  decryptSecret: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../providers/hosted-codex-subscription-credentials", () => ({
  resolveHostedCodexSubscription: (...args: unknown[]) =>
    mocks.resolveHosted(...args),
  decryptHostedMaterial: (...args: unknown[]) => mocks.decryptMaterial(...args),
}));

vi.mock("../platform/kms", () => ({
  decryptSecret: (...args: unknown[]) => mocks.decryptSecret(...args),
}));

vi.mock("../platform/database", () => {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: (...args: unknown[]) => mocks.limit(...args),
  };
  return { getDatabase: () => ({ select: vi.fn(() => query) }) };
});

const { buildApiKeyAuthCache, getGen2ProviderStatus, resolveGen2Codex } =
  await import("./providers");

const userId = "22222222-2222-4222-8222-222222222222";

describe("gen2 provider resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveHosted.mockResolvedValue(null);
    mocks.limit.mockResolvedValue([]);
  });

  it("prefers a ChatGPT subscription and reports its lease id", async () => {
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    mocks.decryptMaterial.mockResolvedValue({ authCacheJson: '{"a":1}' });
    await expect(resolveGen2Codex(userId)).resolves.toEqual({
      credentialId: "cred-1",
      authCacheJson: '{"a":1}',
      via: "subscription",
    });
  });

  it("falls back to a personal API key, with no lease to claim", async () => {
    mocks.limit.mockResolvedValue([{ encryptedApiKey: "enc" }]);
    mocks.decryptSecret.mockResolvedValue("sk-test-123");
    const credential = await resolveGen2Codex(userId);
    // No credentialId means no seat: an API key has no one-turn-at-a-time
    // limit, so the caller must not claim one.
    expect(credential.credentialId).toBeNull();
    expect(credential.via).toBe("api-key");
    expect(JSON.parse(credential.authCacheJson)).toMatchObject({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-123",
    });
  });

  it("asks the member to connect when nothing is available", async () => {
    await expect(resolveGen2Codex(userId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Connect ChatGPT/),
    });
  });

  it("looks at a busy subscription rather than silently using another credential", async () => {
    // A subscription mid-turn must surface as "busy" from the lease, not fall
    // through to an API key and bill the member on two credentials at once.
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    mocks.decryptMaterial.mockResolvedValue({ authCacheJson: "{}" });
    mocks.limit.mockResolvedValue([{ encryptedApiKey: "enc" }]);
    await expect(resolveGen2Codex(userId)).resolves.toMatchObject({
      via: "subscription",
    });
    expect(mocks.resolveHosted).toHaveBeenCalledWith({
      userId,
      includeBusy: true,
    });
  });

  it("reports status without ever returning a secret", async () => {
    mocks.limit.mockResolvedValue([{ encryptedApiKey: "enc" }]);
    mocks.decryptSecret.mockResolvedValue("sk-test-123");
    const status = await getGen2ProviderStatus(userId);
    expect(status).toEqual({ connected: true, via: "api-key" });
    expect(JSON.stringify(status)).not.toContain("sk-test");
  });

  it("reports not connected when there is nothing", async () => {
    await expect(getGen2ProviderStatus(userId)).resolves.toEqual({
      connected: false,
      via: null,
    });
  });

  it("builds an api-key auth cache the Codex CLI understands", () => {
    // auth_mode drives the CLI: without it the CLI takes the API-key path
    // with a null key and hangs.
    expect(JSON.parse(buildApiKeyAuthCache("sk-1"))).toMatchObject({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-1",
    });
  });
});

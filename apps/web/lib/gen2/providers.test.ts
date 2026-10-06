import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/dynamic-models", () => ({
  getDynamicModelsForProvider: async () => [
    { id: "account-model", label: "Account model" },
  ],
}));

const mocks = vi.hoisted(() => ({
  resolveHosted: vi.fn(),
  decryptMaterial: vi.fn(),
  decryptSecret: vi.fn(),
  limit: vi.fn(),
  envRows: vi.fn(),
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
    // The member's environment variables are read with an ordered query that
    // is awaited directly rather than through `limit`.
    orderBy: (...args: unknown[]) => mocks.envRows(...args),
  };
  return { getDatabase: () => ({ select: vi.fn(() => query) }) };
});

const { buildApiKeyAuthCache, getGen2ProviderStatus, resolveGen2Credential } =
  await import("./providers");

const userId = "22222222-2222-4222-8222-222222222222";

describe("gen2 provider resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveHosted.mockResolvedValue(null);
    mocks.limit.mockResolvedValue([]);
    mocks.envRows.mockResolvedValue([]);
  });

  it("carries the member's environment variables into the launch profile", async () => {
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    mocks.decryptMaterial.mockResolvedValue({ authCacheJson: '{"a":1}' });
    mocks.envRows.mockResolvedValue([
      { name: "GITHUB_TOKEN", encryptedValue: "enc-token" },
    ]);
    mocks.decryptSecret.mockResolvedValue("ghp_secret");

    const credential = await resolveGen2Credential(userId, "codex");

    expect(credential.launchProfile.env).toMatchObject({
      GITHUB_TOKEN: "ghp_secret",
    });
    // The credential's own variables win: a member variable named after one
    // the CLI needs must not point it somewhere else.
    expect(credential.launchProfile.env?.CODEX_HOME).toBe(
      "{{profileDir}}/.codex",
    );
    expect(credential.launchProfile.files?.[0]?.path).toBe(".codex/auth.json");
  });

  it("prefers a ChatGPT subscription and reports its lease id", async () => {
    mocks.resolveHosted.mockResolvedValue({
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    mocks.decryptMaterial.mockResolvedValue({ authCacheJson: '{"a":1}' });
    await expect(resolveGen2Credential(userId, "codex")).resolves.toMatchObject(
      {
        credentialId: "cred-1",
        via: "subscription",
      },
    );
  });

  it("falls back to a personal API key, with no lease to claim", async () => {
    mocks.limit.mockResolvedValue([{ encryptedApiKey: "enc" }]);
    mocks.decryptSecret.mockResolvedValue("sk-test-123");
    const credential = await resolveGen2Credential(userId, "codex");
    // No credentialId means no seat: an API key has no one-turn-at-a-time
    // limit, so the caller must not claim one.
    expect(credential.credentialId).toBeNull();
    expect(credential.via).toBe("api-key");
    expect(
      JSON.parse(credential.launchProfile.files![0]!.contents),
    ).toMatchObject({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-123",
    });
  });

  it("asks the member to connect when nothing is available", async () => {
    await expect(resolveGen2Credential(userId, "codex")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Connect Codex/),
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
    await expect(resolveGen2Credential(userId, "codex")).resolves.toMatchObject(
      {
        via: "subscription",
      },
    );
    // Resolution answers "is one connected", never "is one free": busy is a
    // seat question, and reporting a mid-turn subscription as missing used to
    // send members off to reconnect a perfectly good credential.
    expect(mocks.resolveHosted).toHaveBeenCalledWith({ userId });
  });

  it("reports status without ever returning a secret", async () => {
    mocks.limit.mockResolvedValue([{ encryptedApiKey: "enc" }]);
    mocks.decryptSecret.mockResolvedValue("sk-test-123");
    const status = await getGen2ProviderStatus(userId, "codex");
    expect(status).toMatchObject({ connected: true, via: "api-key" });
    expect(JSON.stringify(status)).not.toContain("sk-test");
  });

  it("reports not connected when there is nothing", async () => {
    await expect(getGen2ProviderStatus(userId, "codex")).resolves.toMatchObject(
      {
        connected: false,
        via: null,
      },
    );
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

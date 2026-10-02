import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectedClaudeRuntime: vi.fn(),
  disconnectClaudeRuntime: vi.fn(),
  deleteProviderCredential: vi.fn(),
  getProviderCredentialStatus: vi.fn(),
  saveAnthropicCredential: vi.fn(),
  saveOpenAICredential: vi.fn(),
}));

const hostedCodexMocks = vi.hoisted(() => ({
  disconnectHostedCodexSubscription: vi.fn(),
}));

vi.mock("./credentials", () => mocks);
vi.mock("./claude-connection-session", () => mocks);
vi.mock("./claude-connection-runner", () => ({
  isHostedClaudeConnectEnabled: () => true,
}));
vi.mock("./hosted-codex-subscription-credentials", () => hostedCodexMocks);
vi.mock("../chat/shared-session-view", () => ({
  displayMemberName: (name?: string | null) => name ?? "Unknown user",
}));

import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
  revokePersonalSubscription,
} from "./provider-connection-server";

const user = { id: "user-1", name: "CoDev Test Jordan" };

/**
 * The order `loadProviderConnectionSnapshot` asks for credentials in. The
 * tests drive the mock positionally, so keep this in step with the loader.
 */
const LOOKUPS = [
  ["openai", "API_KEY"],
  ["anthropic", "API_KEY"],
  ["cursor", "API_KEY"],
  ["openai", "HOSTED_CODEX_SUBSCRIPTION"],
  ["openai", "OAUTH_TOKEN"],
  // The Claude CLI setup-token; only a `cli`-stamped row is ever reported.
  ["anthropic", "OAUTH_TOKEN"],
  ["cursor", "OAUTH_TOKEN"],
] as const;

describe("provider connection server", () => {
  beforeEach(() => {
    mocks.getProviderCredentialStatus.mockResolvedValue(null);
    mocks.getConnectedClaudeRuntime.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads API-key connection status for every provider a member can bring", async () => {
    mocks.getProviderCredentialStatus
      .mockResolvedValueOnce({ credentialType: "API_KEY", lastFour: "0001" })
      .mockResolvedValueOnce(null);

    await expect(loadProviderConnectionSnapshot(user)).resolves.toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({
          provider: "openai",
          status: "connected",
          credentialType: "API_KEY",
          lastFour: "0001",
        }),
      ]),
    });
    LOOKUPS.forEach(([provider, credentialType], index) => {
      expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
        index + 1,
        user.id,
        provider,
        credentialType,
      );
    });
  });

  it("loads subscription sign-in status alongside API keys", async () => {
    mocks.getProviderCredentialStatus
      .mockResolvedValueOnce(null) // openai API_KEY
      .mockResolvedValueOnce(null) // anthropic API_KEY
      .mockResolvedValueOnce(null) // cursor API_KEY
      .mockResolvedValueOnce({
        credentialType: "HOSTED_CODEX_SUBSCRIPTION",
        lastFour: "Codex CLI",
      })
      .mockResolvedValueOnce(null) // openai OAUTH_TOKEN
      .mockResolvedValueOnce({
        credentialType: "OAUTH_TOKEN",
        lastFour: "wxyz",
        connectedVia: "browser",
      }) // anthropic OAUTH_TOKEN (the one Claude login)
      .mockResolvedValueOnce(null); // cursor OAUTH_TOKEN

    await expect(loadProviderConnectionSnapshot(user)).resolves.toMatchObject({
      cliSubscriptions: [
        { provider: "codex", status: "connected" },
        // One Claude login, reported the same however it was made.
        {
          provider: "claude",
          status: "connected",
          provenance: "browser",
          allowInSharedWorkspaces: true,
        },
        { provider: "cursor", status: "not_connected" },
      ],
      // The same row the Claude card reads; one login, reported once.
      claudeCliToken: { status: "connected" },
    });
  });

  it("counts an in-app Codex device login as connected without the CLI", async () => {
    mocks.getProviderCredentialStatus
      .mockResolvedValueOnce(null) // openai API_KEY
      .mockResolvedValueOnce(null) // anthropic API_KEY
      .mockResolvedValueOnce(null) // cursor API_KEY
      .mockResolvedValueOnce(null) // no hosted CLI auth cache
      .mockResolvedValueOnce({ credentialType: "OAUTH_TOKEN" });

    await expect(loadProviderConnectionSnapshot(user)).resolves.toMatchObject({
      cliSubscriptions: expect.arrayContaining([
        expect.objectContaining({ provider: "codex", status: "connected" }),
      ]),
    });
  });

  it("revokes only the API key connection", async () => {
    await revokePersonalProviderConnection(user, "openai");

    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      user.id,
      "openai",
      "API_KEY",
    );
  });

  it("clears both Codex logins when the member disconnects Codex", async () => {
    await revokePersonalSubscription(user, "codex");

    expect(
      hostedCodexMocks.disconnectHostedCodexSubscription,
    ).toHaveBeenCalledWith({
      userId: user.id,
    });
    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      user.id,
      "openai",
      "OAUTH_TOKEN",
    );
  });

  it("signs out of Claude without touching its API key", async () => {
    await revokePersonalSubscription(user, "claude");

    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      user.id,
      "anthropic",
      "OAUTH_TOKEN",
    );
    expect(mocks.deleteProviderCredential).not.toHaveBeenCalledWith(
      user.id,
      expect.anything(),
      "API_KEY",
    );
  });

  it("disconnects the Cursor CLI login without removing the API key", async () => {
    await revokePersonalSubscription(user, "cursor");

    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      user.id,
      "cursor",
      "OAUTH_TOKEN",
    );
    expect(mocks.deleteProviderCredential).toHaveBeenCalledTimes(1);
  });
});

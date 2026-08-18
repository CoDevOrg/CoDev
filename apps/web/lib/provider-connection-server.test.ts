import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteProviderCredential: vi.fn(),
  getProviderCredentialStatus: vi.fn(),
  saveAnthropicCredential: vi.fn(),
  saveOpenAICredential: vi.fn(),
}));

vi.mock("./credentials", () => mocks);
vi.mock("./shared-session-view", () => ({
  displayMemberName: (name?: string | null) => name ?? "Unknown user",
}));

import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
} from "./provider-connection-server";

const user = { id: "user-1", name: "CoDev Test Jordan" };

describe("provider connection server", () => {
  beforeEach(() => {
    mocks.getProviderCredentialStatus.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads API-key connection status for OpenAI and Anthropic", async () => {
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
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      1,
      "USER",
      user.id,
      "openai",
      "API_KEY",
    );
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      2,
      "USER",
      user.id,
      "anthropic",
      "API_KEY",
    );
  });

  it("loads Codex and Claude CLI subscription status alongside API keys", async () => {
    mocks.getProviderCredentialStatus
      .mockResolvedValueOnce(null) // openai API_KEY
      .mockResolvedValueOnce(null) // anthropic API_KEY
      .mockResolvedValueOnce({
        credentialType: "HOSTED_CODEX_SUBSCRIPTION",
        lastFour: "Codex CLI",
      })
      .mockResolvedValueOnce({
        credentialType: "OAUTH_TOKEN",
        lastFour: "Claude CLI",
      });

    await expect(loadProviderConnectionSnapshot(user)).resolves.toMatchObject(
      {
        cliSubscriptions: [
          { provider: "codex", status: "connected" },
          { provider: "claude", status: "connected" },
        ],
      },
    );
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      3,
      "USER",
      user.id,
      "openai",
      "HOSTED_CODEX_SUBSCRIPTION",
    );
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      4,
      "USER",
      user.id,
      "anthropic",
      "OAUTH_TOKEN",
    );
  });

  it("revokes only the API key connection", async () => {
    await revokePersonalProviderConnection(user, "openai");

    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      "USER",
      user.id,
      "openai",
      "API_KEY",
    );
  });
});

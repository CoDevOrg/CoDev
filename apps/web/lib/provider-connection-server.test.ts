import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteProviderCredential: vi.fn(),
  getProviderCredentialStatus: vi.fn(),
  saveAnthropicCredential: vi.fn(),
  saveOpenAICredential: vi.fn(),
  saveProviderCredential: vi.fn(),
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

  it("loads API-key rows separately from the OpenAI OAuth record", async () => {
    mocks.getProviderCredentialStatus
      .mockResolvedValueOnce({ credentialType: "API_KEY", lastFour: "0001" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        credentialType: "OAUTH_TOKEN",
        lastFour: "fx01",
      });

    await expect(loadProviderConnectionSnapshot(user)).resolves.toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({
          provider: "openai",
          status: "connected",
          credentialType: "API_KEY",
          lastFour: "0001",
        }),
      ]),
      oauth: expect.objectContaining({
        summary: "Connected · fixture callback",
      }),
    });
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      1,
      "USER",
      user.id,
      "openai",
      "API_KEY",
    );
    expect(mocks.getProviderCredentialStatus).toHaveBeenNthCalledWith(
      3,
      "USER",
      user.id,
      "openai",
      "OAUTH_TOKEN",
    );
  });

  it("revokes only the API key, leaving OAuth to its own lifecycle", async () => {
    await revokePersonalProviderConnection(user, "openai");

    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith(
      "USER",
      user.id,
      "openai",
      "API_KEY",
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAgentCredential: vi.fn(),
}));

vi.mock("./credentials", () => ({
  resolveAgentCredential: mocks.resolveAgentCredential,
}));

import {
  ProviderConnectionRequiredError,
  assertProviderConnectionForTurn,
  isProviderConnectionBlockMessage,
} from "./provider-turn-auth";

afterEach(() => {
  vi.clearAllMocks();
});

describe("assertProviderConnectionForTurn", () => {
  it("returns the live credential when the connection is still present", async () => {
    mocks.resolveAgentCredential.mockResolvedValue({
      source: "USER",
      apiKeyOrToken: "decrypted-secret",
    });

    await expect(
      assertProviderConnectionForTurn("user-1", "workspace-1", "openai"),
    ).resolves.toMatchObject({ source: "USER" });
    expect(mocks.resolveAgentCredential).toHaveBeenCalledWith(
      "user-1",
      "workspace-1",
      "openai",
    );
  });

  it("blocks the next turn after the connection is revoked without leaking the secret", async () => {
    mocks.resolveAgentCredential.mockRejectedValue(
      new Error(
        "Connect a Codex, Claude, or Cursor credential in Settings before using openai agents.",
      ),
    );

    await expect(
      assertProviderConnectionForTurn("user-1", "workspace-1", "openai"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderConnectionRequiredError);
      const blocked = error as ProviderConnectionRequiredError;
      expect(blocked.status).toBe(409);
      expect(blocked.code).toBe("provider_connection_required");
      expect(blocked.message).toMatch(/OpenAI connection was revoked/);
      expect(blocked.message).toMatch(/existing session is unchanged/);
      expect(blocked.message).not.toMatch(/decrypted-secret|sk-/i);
      expect(isProviderConnectionBlockMessage(blocked.message)).toBe(true);
      return true;
    });
  });
});

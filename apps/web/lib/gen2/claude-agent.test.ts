import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CredentialUnavailableError extends Error {
    reason = "not_connected";
  }
  return {
    CredentialUnavailableError,
    requireCredential: vi.fn(),
    resolveCredential: vi.fn(),
    envVariables: vi.fn(),
  };
});

vi.mock("../providers/resolve", () => ({
  CredentialUnavailableError: mocks.CredentialUnavailableError,
  requireCredential: (...args: unknown[]) => mocks.requireCredential(...args),
  resolveCredential: (...args: unknown[]) => mocks.resolveCredential(...args),
}));

vi.mock("../providers/user-environment", () => ({
  listDecryptedUserEnvironmentVariables: (...args: unknown[]) =>
    mocks.envVariables(...args),
}));

const { resolveGen2Credential, getGen2ProviderStatus } =
  await import("./providers");
const { buildGen2AgentCommand } = await import("./agent-command");

describe("gen2 Claude credential", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.envVariables.mockResolvedValue({});
  });

  it("resolves on the gen2 executor and carries the token as environment", async () => {
    mocks.requireCredential.mockResolvedValue({
      kind: "claude_setup_token",
      credentialId: "cred-9",
      secret: { kind: "claude_setup_token", token: "tok-abc" },
    });

    const credential = await resolveGen2Credential("user-1", "claude");

    expect(mocks.requireCredential).toHaveBeenCalledWith({
      userId: "user-1",
      provider: "claude",
      surface: "gen2",
    });
    expect(credential.launchProfile.env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "tok-abc",
    });
    // There is no Codex auth cache to fall back on, and no seat to hold.
    expect(credential.credentialId).toBeNull();
    expect(credential.via).toBe("subscription");
  });

  it("tells the member to connect Claude, not ChatGPT", async () => {
    mocks.requireCredential.mockRejectedValue(
      new mocks.CredentialUnavailableError(),
    );
    await expect(
      resolveGen2Credential("user-1", "claude"),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Claude/),
    });
  });

  it("reports Claude status per provider", async () => {
    mocks.resolveCredential.mockResolvedValue({
      ok: true,
      kind: "claude_setup_token",
    });
    await expect(getGen2ProviderStatus("user-1", "claude")).resolves.toEqual({
      connected: true,
      via: "subscription",
    });
    expect(mocks.resolveCredential).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", surface: "gen2" }),
    );
  });
});

describe("buildGen2AgentCommand", () => {
  it("builds a stream-json claude invocation with the prompt last", () => {
    const command = buildGen2AgentCommand("claude", "List the files", [
      { role: "user", body: "hi" },
    ]);
    expect(command.slice(0, 5)).toEqual([
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(command.at(-1)).toContain("List the files");
    // The credential never rides the command line.
    expect(command.join(" ")).not.toMatch(/OAUTH|token/i);
  });

  it("keeps Codex on `codex exec`", () => {
    expect(buildGen2AgentCommand("codex", "x").slice(0, 3)).toEqual([
      "codex",
      "exec",
      "--json",
    ]);
  });
});

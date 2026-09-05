import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./credentials", () => ({ saveProviderCredential: vi.fn() }));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));

import {
  ClaudeConnectionError,
  redactClaudeSecrets,
  resolveClaudeConnectionScope,
  saveClaudeConnectionForUser,
  validateClaudeOAuthToken,
} from "./claude-connection";
import { saveProviderCredential } from "./credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const saveProviderCredentialMock = vi.mocked(saveProviderCredential);
const requireOrganizationSettingsWriteMock = vi.mocked(
  requireOrganizationSettingsWrite,
);

const TOKEN = "sk-ant-oat01-abc123XYZ_-4567890";

beforeEach(() => {
  saveProviderCredentialMock.mockReset();
  requireOrganizationSettingsWriteMock.mockReset();
});

describe("validateClaudeOAuthToken", () => {
  it("accepts a well-formed token and rejects junk", () => {
    expect(validateClaudeOAuthToken(TOKEN)).toBe(TOKEN);
    expect(() => validateClaudeOAuthToken("nope")).toThrow(/usable token/);
  });
});

describe("redactClaudeSecrets", () => {
  it("strips Claude tokens from free text but leaves the rest", () => {
    const out = redactClaudeSecrets(
      `login ok Token: ${TOKEN} exit 0\nsk-ant-api03-${"z".repeat(40)} also`,
    );
    expect(out).not.toContain(TOKEN);
    expect(out).not.toMatch(/sk-ant-[A-Za-z0-9_-]{12,}/);
    expect(out).toContain("login ok");
    expect(out).toContain("exit 0");
  });
});

describe("resolveClaudeConnectionScope", () => {
  it("defaults to the user's own scope", async () => {
    await expect(
      resolveClaudeConnectionScope({ userId: "u1" }),
    ).resolves.toEqual({ scopeType: "USER", scopeId: "u1" });
    expect(requireOrganizationSettingsWriteMock).not.toHaveBeenCalled();
  });

  it("requires org write access for an organization scope", async () => {
    requireOrganizationSettingsWriteMock.mockRejectedValueOnce(new Error("no"));
    await expect(
      resolveClaudeConnectionScope({
        userId: "u1",
        scopeType: "ORGANIZATION",
        organizationId: "org1",
      }),
    ).rejects.toBeInstanceOf(ClaudeConnectionError);
  });
});

describe("saveClaudeConnectionForUser", () => {
  it("persists the token as an anthropic OAUTH_TOKEN credential", async () => {
    await saveClaudeConnectionForUser("u1", { oauthToken: TOKEN });
    expect(saveProviderCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "USER",
        scopeId: "u1",
        provider: "anthropic",
        credentialType: "OAUTH_TOKEN",
        accessToken: TOKEN,
      }),
    );
  });

  it("rejects a malformed token before writing anything", async () => {
    await expect(
      saveClaudeConnectionForUser("u1", { oauthToken: "bad" }),
    ).rejects.toBeInstanceOf(ClaudeConnectionError);
    expect(saveProviderCredentialMock).not.toHaveBeenCalled();
  });
});

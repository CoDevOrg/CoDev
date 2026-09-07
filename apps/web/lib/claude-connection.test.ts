import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./credentials", () => ({ saveProviderCredential: vi.fn() }));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));
vi.mock("./observability", () => ({ logEvent: vi.fn() }));

import {
  ClaudeConnectionError,
  redactClaudeSecrets,
  toClaudeConnectionFailure,
  verifyClaudeInferenceAccess,
  resolveClaudeConnectionScope,
  saveClaudeConnectionForUser,
  validateClaudeOAuthToken,
} from "./claude-connection";
import { saveProviderCredential } from "./credentials";
import { logEvent } from "./observability";
import { requireOrganizationSettingsWrite } from "./settings-access";

const saveProviderCredentialMock = vi.mocked(saveProviderCredential);
const requireOrganizationSettingsWriteMock = vi.mocked(
  requireOrganizationSettingsWrite,
);
const logEventMock = vi.mocked(logEvent);

const TOKEN = "sk-ant-oat01-abc123XYZ_-4567890";

beforeEach(() => {
  saveProviderCredentialMock.mockReset();
  requireOrganizationSettingsWriteMock.mockReset();
  logEventMock.mockReset();
});

describe("toClaudeConnectionFailure", () => {
  it("passes a ClaudeConnectionError through untouched and does not log", () => {
    const original = new ClaudeConnectionError("Start a new one.", 409);
    expect(toClaudeConnectionFailure(original, "evt")).toBe(original);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("replaces a raw error with a generic message and logs the detail", () => {
    const raw = new Error(
      `Failed query: delete from "claude_connection_sessions" where "user_id" = $1 params: 464b50d7`,
    );
    const failure = toClaudeConnectionFailure(
      raw,
      "claude_connection.x_failed",
    );
    expect(failure).toBeInstanceOf(ClaudeConnectionError);
    expect(failure.status).toBe(500);
    expect(failure.message).not.toContain("claude_connection_sessions");
    expect(failure.message).not.toContain("delete from");
    expect(logEventMock).toHaveBeenCalledWith(
      "error",
      "claude_connection.x_failed",
      expect.objectContaining({
        detail: expect.stringContaining("Failed query"),
      }),
    );
  });

  it("redacts a Claude token from the logged detail", () => {
    toClaudeConnectionFailure(
      new Error(`runner crashed with ${TOKEN} in output`),
      "evt",
    );
    const context = logEventMock.mock.calls[0]?.[2] ?? {};
    expect(context.detail).not.toContain(TOKEN);
  });
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

describe("verifyClaudeInferenceAccess", () => {
  it("passes on 200, throws on a hard auth rejection, tolerates a 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      verifyClaudeInferenceAccess("sk-ant-oat01-x"),
    ).resolves.toBeUndefined();
    await expect(
      verifyClaudeInferenceAccess("sk-ant-oat01-x"),
    ).rejects.toBeInstanceOf(ClaudeConnectionError);
    await expect(
      verifyClaudeInferenceAccess("sk-ant-oat01-x"),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
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

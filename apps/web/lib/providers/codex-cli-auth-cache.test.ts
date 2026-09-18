import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));
vi.mock("../auth/cli-auth", async () => {
  const actual =
    await vi.importActual<typeof import("../auth/cli-auth")>(
      "../auth/cli-auth",
    );
  return { ...actual, authenticateCliRequest: vi.fn() };
});
vi.mock("./hosted-codex-subscription-credentials", () => ({
  persistHostedCodexConnection: vi.fn(),
}));
vi.mock("../auth/settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));

import { validateCodexAuthCache } from "./codex-cli-auth-cache";

describe("validateCodexAuthCache", () => {
  it("accepts the official ChatGPT token cache shape without exposing fields", () => {
    const cache = {
      auth_mode: "chatgpt",
      tokens: { access_token: "access", refresh_token: "refresh" },
    };
    expect(JSON.parse(validateCodexAuthCache(cache))).toEqual(cache);
  });

  it("rejects API-key-only or incomplete files", () => {
    expect(() => validateCodexAuthCache({ OPENAI_API_KEY: "sk-test" })).toThrow(
      /access and refresh token/,
    );
  });
});

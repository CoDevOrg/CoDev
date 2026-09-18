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
vi.mock("./credentials", () => ({ saveProviderCredential: vi.fn() }));
vi.mock("../auth/settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));

import { validateClaudeOAuthToken } from "./claude-cli-auth";

describe("validateClaudeOAuthToken", () => {
  it("accepts a well-formed Claude Code OAuth token", () => {
    expect(validateClaudeOAuthToken("sk-ant-oat01-abc123XYZ_-4567890")).toBe(
      "sk-ant-oat01-abc123XYZ_-4567890",
    );
  });

  it("rejects missing or malformed tokens", () => {
    expect(() => validateClaudeOAuthToken(undefined)).toThrow(/usable token/);
    expect(() => validateClaudeOAuthToken("not-a-token")).toThrow(
      /usable token/,
    );
  });
});

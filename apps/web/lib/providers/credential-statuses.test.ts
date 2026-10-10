import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: async () => mocks.rows }) }),
    }),
  }),
}));
vi.mock("../platform/kms", () => ({
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
}));
import { listProviderCredentialStatuses } from "./credentials";

const row = (overrides: Record<string, unknown>) => ({
  provider: "openai",
  credentialType: "API_KEY",
  lastFour: null,
  endpointUrl: null,
  awsRoleArn: null,
  updatedAt: new Date(0),
  connectedVia: null,
  ...overrides,
});

describe("listProviderCredentialStatuses", () => {
  it("answers every card from one query with findCredential's rules", async () => {
    // Rows arrive ordered by priority, so the first match per type wins.
    mocks.rows = [
      row({ lastFour: "0001" }),
      row({ lastFour: "0002" }),
      row({
        provider: "anthropic",
        credentialType: "OAUTH_TOKEN",
        connectedVia: "browser",
      }),
      row({
        provider: "cursor",
        credentialType: "OAUTH_TOKEN",
        connectedVia: "cli",
      }),
    ];
    const status = await listProviderCredentialStatuses("u");
    expect(status("openai", "API_KEY")?.lastFour).toBe("0001");
    expect(status("openai", "OAUTH_TOKEN")).toBeNull();
    // A browser-era Claude token is retired and never reported.
    expect(status("anthropic", "OAUTH_TOKEN")).toBeNull();
    expect(status("cursor", "OAUTH_TOKEN")?.connectedVia).toBe("cli");
  });
});

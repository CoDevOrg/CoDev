import { afterEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => [] as Array<Record<string, unknown>[]>);
const mockHostedSubscription = vi.hoisted(() =>
  vi.fn<
    (input: { userId: string; workspaceId: string }) => Promise<{
      source: "USER" | "ORGANIZATION";
      credential: { id: string; encryptedMaterial: string };
    } | null>
  >(async () => null),
);
const mockDatabase = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => mockRows.shift() ?? []),
        })),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  })),
}));

vi.mock("./database", () => ({
  getDatabase: () => mockDatabase,
}));

vi.mock("./kms", () => ({
  decryptSecret: vi.fn(async () => "decrypted-secret"),
  encryptSecret: vi.fn(async (value: string) => `encrypted:${value}`),
}));

vi.mock("./hosted-codex-subscription-credentials", () => ({
  resolveHostedCodexSubscription: mockHostedSubscription,
  decryptHostedMaterial: vi.fn(async () => ({
    authCacheJson: '{"tokens":{"access_token":"a","refresh_token":"r"}}',
  })),
}));

import { resolveAgentCredential } from "./credentials";

const baseCredential = (overrides: Record<string, unknown> = {}) => ({
  id: "credential-1",
  scopeType: "USER",
  scopeId: "user-1",
  provider: "openai",
  credentialType: "API_KEY",
  priorityOrder: 0,
  encryptedApiKey: "ciphertext",
  encryptedAccessToken: null,
  encryptedRefreshToken: null,
  expiresAt: null,
  endpointUrl: null,
  awsRoleArn: null,
  isConnected: true,
  keyVersion: 2,
  lastFour: "1234",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

afterEach(() => {
  mockRows.length = 0;
  mockHostedSubscription.mockReset();
  mockHostedSubscription.mockResolvedValue(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveAgentCredential", () => {
  it("resolves the encrypted official Codex auth cache", async () => {
    mockHostedSubscription.mockResolvedValueOnce({
      source: "USER",
      credential: {
        id: "hosted-credential",
        encryptedMaterial: "encrypted-cache",
      },
    });

    const resolved = await resolveAgentCredential(
      "user-1",
      "workspace-1",
      "openai",
    );

    expect(mockHostedSubscription).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(resolved).toMatchObject({
      authType: "HOSTED_CODEX_SUBSCRIPTION",
      codexAuthCacheJson: '{"tokens":{"access_token":"a","refresh_token":"r"}}',
      credentialId: "hosted-credential",
    });
    expect(mockDatabase.select).not.toHaveBeenCalled();
  });

  it("prefers a personal credential over workspace credentials", async () => {
    mockRows.push([baseCredential()]);

    const resolved = await resolveAgentCredential(
      "user-1",
      "workspace-1",
      "openai",
    );

    expect(resolved.source).toBe("USER");
    expect(resolved.apiKeyOrToken).toBe("decrypted-secret");
  });

  it("falls back to the workspace credential before failing", async () => {
    mockRows.push(
      [],
      [
        baseCredential({
          id: "workspace-credential",
          scopeType: "WORKSPACE",
          scopeId: "workspace-1",
        }),
      ],
    );

    const resolved = await resolveAgentCredential(
      "user-1",
      "workspace-1",
      "openai",
    );

    expect(resolved.source).toBe("WORKSPACE");
    expect(resolved.apiKeyOrToken).toBe("decrypted-secret");
  });

  it("rejects platform keys and requires BYOK", async () => {
    mockRows.push([], []);
    vi.stubEnv("CODEV_PLATFORM_OPENAI_API_KEY", "platform-key");
    vi.stubEnv("OPENAI_API_KEY", "platform-key");

    await expect(
      resolveAgentCredential("user-1", "workspace-1", "openai"),
    ).rejects.toThrow(/Connect a Codex, Claude, or Cursor credential/);
  });

  it("refreshes an OAuth token inside the five-minute window", async () => {
    mockRows.push([
      baseCredential({
        credentialType: "OAUTH_TOKEN",
        encryptedApiKey: null,
        encryptedAccessToken: "access-ciphertext",
        encryptedRefreshToken: "refresh-ciphertext",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ]);
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "codex-client");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 3600,
        }),
      })),
    );

    const resolved = await resolveAgentCredential(
      "user-1",
      "workspace-1",
      "openai",
    );

    expect(resolved.apiKeyOrToken).toBe("refreshed-access-token");
    expect(mockDatabase.update).toHaveBeenCalledOnce();
  });
});

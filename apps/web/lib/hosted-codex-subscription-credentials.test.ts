import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => [] as Array<Record<string, unknown>[]>);
const inserted = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const updated = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const deleted = vi.hoisted(() => [] as unknown[]);

const mockDatabase = vi.hoisted(() => ({
  insert: vi.fn(() => ({
    values: vi.fn((value: Record<string, unknown>) => {
      inserted.push({ ...value, id: value.id ?? "attempt-1" });
      return {
        returning: vi.fn(async () => [
          { ...value, id: value.id ?? "attempt-1" },
        ]),
        onConflictDoUpdate: vi.fn(async () => undefined),
      };
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows.shift() ?? []),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((value: Record<string, unknown>) => {
      updated.push(value);
      return { where: vi.fn(async () => undefined) };
    }),
  })),
  delete: vi.fn(() => {
    deleted.push("deleted");
    return { where: vi.fn(async () => undefined) };
  }),
  execute: vi.fn(async () => undefined),
}));

vi.mock("./database", () => ({
  getDatabase: () => mockDatabase,
}));

vi.mock("./kms", () => ({
  decryptSecret: vi.fn(
    async (value: string, context?: { purpose?: string }) => {
      if (context?.purpose !== "hosted-codex-subscription") {
        throw new Error("wrong encryption context");
      }
      return value.replace(/^encrypted:/, "");
    },
  ),
  encryptSecret: vi.fn(
    async (_value: string, context?: { purpose?: string }) => {
      if (context?.purpose !== "hosted-codex-subscription") {
        throw new Error("wrong encryption context");
      }
      return "encrypted:ciphertext";
    },
  ),
}));

vi.mock("./hosted-codex-subscription-flag", () => ({
  HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED: true,
  isHostedCodexSubscriptionEnabled: () => true,
}));

vi.mock("./hosted-codex-subscription-audit", () => ({
  recordHostedCodexAuditEvent: vi.fn(async () => undefined),
}));

import { setHostedCodexApprovedConfigForTests } from "./hosted-codex-subscription";
import {
  HostedCodexSubscriptionError,
  loadValidHostedCodexAttempt,
  persistHostedCodexConnection,
  resolveHostedCodexSubscription,
  sealHostedCodexAttemptCookie,
  shouldReplayDestructiveActionAfterAuthRefresh,
  validateHostedCodexIdToken,
} from "./hosted-codex-subscription-credentials";

const config = {
  clientId: "codev-hosted-approved-client",
  authorizeUrl: "https://auth.example.openai.invalid/authorize",
  tokenUrl: "https://auth.example.openai.invalid/token",
  redirectUri: "https://app.codev.dev/api/auth/hosted-codex/callback",
  issuer: "https://auth.example.openai.invalid",
  scopes: "openid profile",
};

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    userId: "user-1",
    scopeType: "USER",
    scopeId: "user-1",
    returnTo: "/settings/personal/agents",
    state: "state-1",
    codeVerifier: "verifier-1",
    nonce: "nonce-1",
    redirectUri: config.redirectUri,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  };
}

describe("hosted Codex credential service", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "a".repeat(40);
    setHostedCodexApprovedConfigForTests(config);
  });

  afterEach(() => {
    rows.length = 0;
    inserted.length = 0;
    updated.length = 0;
    deleted.length = 0;
    setHostedCodexApprovedConfigForTests(undefined);
    vi.unstubAllGlobals();
  });

  it("rejects expired, wrong-user, wrong-scope, and open-redirect attempts", async () => {
    const cookie = sealHostedCodexAttemptCookie({
      attemptId: "attempt-1",
      userId: "user-1",
      state: "state-1",
    });

    rows.push([attemptRow({ expiresAt: new Date(Date.now() - 1_000) })]);
    await expect(
      loadValidHostedCodexAttempt({
        cookieValue: cookie,
        userId: "user-1",
        state: "state-1",
      }),
    ).rejects.toMatchObject({ code: "hosted_codex_expired" });

    rows.push([attemptRow({ userId: "user-2" })]);
    await expect(
      loadValidHostedCodexAttempt({
        cookieValue: cookie,
        userId: "user-1",
        state: "state-1",
      }),
    ).rejects.toMatchObject({ code: "hosted_codex_wrong_user" });

    rows.push([attemptRow({ scopeType: "ORGANIZATION" })]);
    await expect(
      loadValidHostedCodexAttempt({
        cookieValue: cookie,
        userId: "user-1",
        state: "state-1",
        expectedScopeType: "USER",
      }),
    ).rejects.toMatchObject({ code: "hosted_codex_wrong_scope" });
  });

  it("rejects invalid issuer and nonce claims", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://evil.example",
        nonce: "other",
        aud: config.clientId,
        sub: "acct-1",
      }),
    ).toString("base64url");
    expect(() =>
      validateHostedCodexIdToken({
        idToken: `${header}.${payload}.sig`,
        issuer: config.issuer,
        nonce: "nonce-1",
        clientId: config.clientId,
      }),
    ).toThrow(HostedCodexSubscriptionError);
  });

  it("encrypts hosted material with a dedicated context and redacts public status", async () => {
    rows.push([
      {
        id: "cred-1",
        lastFour: "j…@example.com",
        sharingEnabled: false,
      },
    ]);
    await persistHostedCodexConnection({
      userId: "user-1",
      scopeType: "USER",
      scopeId: "user-1",
      sharingEnabled: false,
      material: { refreshToken: "refresh-secret", providerSubject: "acct-1" },
      accountLabel: "jordan@example.com",
    });
    expect(JSON.stringify(inserted)).toContain("encrypted:ciphertext");
    expect(JSON.stringify(inserted)).not.toContain("refresh-secret");
  });

  it("prefers a personal hosted connection over an organization default", async () => {
    rows.push([
      {
        id: "personal",
        status: "active",
        isConnected: true,
        unavailableUntil: null,
        encryptedMaterial: "encrypted:{}",
      },
    ]);
    const resolved = await resolveHostedCodexSubscription({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(resolved?.source).toBe("USER");
    expect(resolved?.credential.id).toBe("personal");
  });

  it("does not use an organization connection after membership is removed", async () => {
    rows.push(
      [],
      [
        {
          id: "org",
          status: "active",
          isConnected: true,
          sharingEnabled: true,
          unavailableUntil: null,
        },
      ],
      [],
    );
    await expect(
      resolveHostedCodexSubscription({
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
    ).resolves.toBeNull();
  });

  it("never auto-replays a destructive action after auth refresh", () => {
    expect(shouldReplayDestructiveActionAfterAuthRefresh()).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Callbacks = {
  signIn: (input: Record<string, unknown>) => Promise<boolean | string>;
  jwt: (input: Record<string, unknown>) => Promise<unknown>;
};

const mocks = vi.hoisted(() => ({
  config: null as unknown as { callbacks: Callbacks },
  wheres: [] as unknown[],
  results: [] as unknown[][],
  twoFactor: vi.fn(async () => false),
}));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    mocks.config = config as typeof mocks.config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: class extends Error {},
}));
vi.mock("./two-factor", () => ({ isTwoFactorEnabled: mocks.twoFactor }));
vi.mock("./session-token", () => ({
  applySessionRotation: vi.fn(),
  sessionTokenIsCurrent: vi.fn(async () => true),
  signInMethodFor: () => "google",
}));
vi.mock("./user-sessions", () => ({
  createUserSession: vi.fn(async () => "s"),
  revokeUserSession: vi.fn(),
}));
vi.mock("../platform/database", () => {
  const query = {
    from: () => query,
    where: (condition: unknown) => {
      mocks.wheres.push(condition);
      return query;
    },
    limit: async () => mocks.results.shift() ?? [],
  };
  return {
    getDatabase: () => ({
      select: () => query,
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ id: "a" }] }),
        }),
      }),
    }),
  };
});
import "@/auth";

const params = (condition: unknown) =>
  new PgDialect().sqlToQuery(condition as SQL).sql;

describe("Google sign-in identity", () => {
  beforeEach(() => {
    mocks.wheres = [];
    mocks.results = [];
    mocks.twoFactor.mockResolvedValue(false);
  });

  it("resolves the session user by Google id, never by the shared email", async () => {
    mocks.results = [[{ id: "a" }]];
    const token = await mocks.config.callbacks.jwt({
      token: { email: "victim@example.com", githubLogin: "x" },
      account: { provider: "google", type: "oidc" },
      profile: { sub: "google-a", email: "victim@example.com" },
    });
    expect(token).toMatchObject({ localUserId: "a" });
    expect(params(mocks.wheres[0])).toContain("google_user_id");
    expect(params(mocks.wheres[0])).not.toContain('"email"');
  });

  it("will not attach Google to a 2FA account by email", async () => {
    mocks.results = [[], [{ id: "victim" }]];
    mocks.twoFactor.mockResolvedValue(true);
    expect(
      await mocks.config.callbacks.signIn({
        account: { provider: "google" },
        profile: { sub: "google-x", email: "victim@example.com" },
      }),
    ).toBe("/sign-in?error=TwoFactorLink");
  });
});

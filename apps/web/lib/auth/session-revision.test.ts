import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

const mocks = vi.hoisted(() => ({
  config: null as unknown as {
    callbacks: { jwt: (input: Record<string, unknown>) => Promise<JWT | null> };
  },
  rows: [] as { id: string; passwordHash: string | null }[],
}));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    mocks.config = config as typeof mocks.config;
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      unstable_update: vi.fn(),
    };
  },
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
    }),
  }),
}));
import "@/auth";
import { sessionRevision } from "./session-revision";

const jwt = (token: JWT, extra: Record<string, unknown> = {}) =>
  mocks.config.callbacks.jwt({ token, ...extra });
beforeEach(() => {
  mocks.rows = [{ id: "u", passwordHash: "old-hash" }];
});
describe("credential-bound sessions", () => {
  it("binds fresh sign-ins to the current password state", async () => {
    expect(
      await jwt(
        { githubLogin: "ada" },
        {
          account: { provider: "credentials", type: "credentials" },
          user: { id: "u", credentialRevision: sessionRevision("old-hash") },
        },
      ),
    ).toMatchObject({
      localUserId: "u",
      credentialRevision: sessionRevision("old-hash"),
    });
  });
  it("rejects a login if the password changed after verification", async () => {
    expect(
      await jwt(
        { githubLogin: "ada" },
        {
          account: { provider: "credentials", type: "credentials" },
          user: { id: "u", credentialRevision: sessionRevision("stale-hash") },
        },
      ),
    ).toBeNull();
  });
  it("accepts unchanged sessions and rejects them after a password reset", async () => {
    const token = {
      localUserId: "u",
      githubLogin: "ada",
      credentialRevision: sessionRevision("old-hash"),
    };
    expect(await jwt({ ...token })).not.toBeNull();
    mocks.rows = [{ id: "u", passwordHash: "new-hash" }];
    expect(await jwt({ ...token })).toBeNull();
  });
  it("does not let a client session update rebind a revoked token", async () => {
    expect(
      await jwt(
        {
          localUserId: "u",
          githubLogin: "ada",
          credentialRevision: sessionRevision("revoked"),
        },
        {
          trigger: "update",
          session: {
            user: {
              name: "Ada",
              credentialRevision: sessionRevision("old-hash"),
            },
          },
        },
      ),
    ).toBeNull();
  });
  it("rejects legacy sessions and deleted accounts", async () => {
    expect(await jwt({ localUserId: "u", githubLogin: "ada" })).toBeNull();
    mocks.rows = [];
    expect(
      await jwt({
        localUserId: "u",
        githubLogin: "ada",
        credentialRevision: sessionRevision("old-hash"),
      }),
    ).toBeNull();
  });
  it("also invalidates OAuth sessions when a password is added", async () => {
    expect(
      await jwt({
        localUserId: "u",
        githubLogin: "ada",
        credentialRevision: sessionRevision(null),
      }),
    ).toBeNull();
  });
});

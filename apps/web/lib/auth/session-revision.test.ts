import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

const mocks = vi.hoisted(() => ({
  config: null as unknown as {
    callbacks: { jwt: (input: Record<string, unknown>) => Promise<JWT | null> };
  },
  rows: [] as {
    id: string;
    passwordHash: string | null;
    sessionId?: string | null;
    revokedAt?: Date | null;
  }[],
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
  CredentialsSignin: class extends Error {},
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows }),
        leftJoin: () => ({
          where: () => ({
            limit: async () =>
              mocks.rows.map((row) => ({
                sessionId: "s-new",
                revokedAt: null,
                lastSeenAt: new Date(),
                ...row,
              })),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () =>
        Object.assign(Promise.resolve(), {
          returning: async () => [{ id: "s-new" }],
        }),
    }),
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }),
}));
import "@/auth";
import { sessionRevision } from "./session-revision";
import { sealSessionRotation } from "./session-token";

const jwt = (token: JWT, extra: Record<string, unknown> = {}) =>
  mocks.config.callbacks.jwt({ token, ...extra });
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
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
  it("starts a revocable session row at sign-in", async () => {
    expect(
      await jwt(
        { githubLogin: "ada" },
        {
          account: { provider: "credentials", type: "credentials" },
          user: { id: "u", credentialRevision: sessionRevision("old-hash") },
        },
      ),
    ).toMatchObject({ sid: "s-new" });
  });
  it("signs out a tracked session once its row is revoked or gone", async () => {
    const token = {
      localUserId: "u",
      sid: "s1",
      githubLogin: "ada",
      credentialRevision: sessionRevision("old-hash"),
    };
    mocks.rows = [{ id: "u", passwordHash: "old-hash", sessionId: "s1" }];
    expect(await jwt({ ...token })).not.toBeNull();
    mocks.rows = [
      {
        id: "u",
        passwordHash: "old-hash",
        sessionId: "s1",
        revokedAt: new Date(),
      },
    ];
    expect(await jwt({ ...token })).toBeNull();
    mocks.rows = [{ id: "u", passwordHash: "old-hash", sessionId: null }];
    expect(await jwt({ ...token })).toBeNull();
  });
  it("keeps only the browser holding a signed rotation across its password change", async () => {
    mocks.rows = [{ id: "u", passwordHash: "new-hash", sessionId: "s1" }];
    const token = () => ({
      localUserId: "u",
      sid: "s1",
      githubLogin: "ada",
      credentialRevision: sessionRevision("old-hash"),
    });
    const rotation = (fromSessionId: string) =>
      sealSessionRotation({
        userId: "u",
        fromSessionId,
        toSessionId: "s1",
        credentialRevision: sessionRevision("new-hash"),
      });
    expect(
      await jwt(token(), {
        trigger: "update",
        session: { rotation: rotation("s1") },
      }),
    ).toMatchObject({ credentialRevision: sessionRevision("new-hash") });
    expect(
      await jwt(token(), {
        trigger: "update",
        session: { rotation: rotation("s2") },
      }),
    ).toBeNull();
    expect(
      await jwt(token(), {
        trigger: "update",
        session: { rotation: "forged.value" },
      }),
    ).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  verify: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
      }),
    }),
  }),
}));
vi.mock("../platform/crypto", () => ({ verifyPassword: mocks.verify }));
vi.mock("../platform/rate-limit", () => ({ consumeRateLimit: mocks.limit }));
import { verifyRecentAuthentication } from "./recent-authentication";

const user = { id: "u", sessionId: "s" };

describe("verifyRecentAuthentication", () => {
  beforeEach(() => {
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.verify.mockResolvedValue(true);
  });

  it("asks password accounts for their current password, rate limited", async () => {
    mocks.rows = [{ passwordHash: "h", signedInAt: new Date() }];
    expect(await verifyRecentAuthentication(user, "right")).toBeNull();
    mocks.verify.mockResolvedValue(false);
    expect(await verifyRecentAuthentication(user, "wrong")).toMatch(
      /current password/,
    );
    mocks.limit.mockResolvedValue({ allowed: false });
    expect(await verifyRecentAuthentication(user, "right")).toMatch(/Too many/);
  });

  it("lets OAuth-only accounts through only shortly after signing in", async () => {
    mocks.rows = [{ passwordHash: null, signedInAt: new Date() }];
    expect(await verifyRecentAuthentication(user, "")).toBeNull();
    mocks.rows = [
      { passwordHash: null, signedInAt: new Date(Date.now() - 16 * 60_000) },
    ];
    expect(await verifyRecentAuthentication(user, "")).toMatch(/sign in again/);
    mocks.rows = [{ passwordHash: null, signedInAt: null }];
    expect(await verifyRecentAuthentication(user, "")).toMatch(/sign in again/);
  });
});

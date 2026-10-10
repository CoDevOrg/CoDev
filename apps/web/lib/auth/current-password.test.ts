import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  verify: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
    }),
  }),
}));
vi.mock("../platform/crypto", () => ({ verifyPassword: mocks.verify }));
vi.mock("../platform/rate-limit", () => ({ consumeRateLimit: mocks.limit }));
import { confirmCurrentPassword } from "./current-password";

describe("confirmCurrentPassword", () => {
  beforeEach(() => {
    mocks.rows = [{ passwordHash: "h" }];
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.verify.mockResolvedValue(true);
  });

  it("returns the hash for the right password", async () => {
    expect(await confirmCurrentPassword("u", "right")).toEqual({
      ok: true,
      passwordHash: "h",
    });
  });

  it("refuses a wrong password, a passwordless account, and too many tries", async () => {
    mocks.verify.mockResolvedValue(false);
    expect(await confirmCurrentPassword("u", "wrong")).toMatchObject({
      ok: false,
    });
    mocks.rows = [{ passwordHash: null }];
    expect(await confirmCurrentPassword("u", "")).toMatchObject({
      message: expect.stringMatching(/does not have a password/),
    });
    mocks.limit.mockResolvedValue({ allowed: false });
    expect(await confirmCurrentPassword("u", "right")).toMatchObject({
      message: expect.stringMatching(/Too many/),
    });
  });
});

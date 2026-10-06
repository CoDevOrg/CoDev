import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));
vi.mock("../platform/kms", () => ({ encryptSecret: mocks.encrypt }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({ update: () => ({ set: mocks.set }) }),
}));
import { updateCursorAuthCache } from "./cursor-auth-refresh";

describe("Cursor login refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.encrypt.mockResolvedValue("encrypted-cache");
    mocks.set.mockReturnValue({ where: mocks.where });
  });
  it("updates only an active personal Cursor subscription, preserving its sharing preference", async () => {
    await updateCursorAuthCache(
      "member",
      JSON.stringify({ accessToken: "cursor-access-token-value-0001" }),
    );
    expect(mocks.set.mock.calls[0]?.[0]).toMatchObject({
      encryptedAccessToken: "encrypted-cache",
    });
    expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty(
      "allowInSharedWorkspaces",
    );
    expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty("status");
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(query.params).toEqual([
      "USER",
      "member",
      "cursor",
      "OAUTH_TOKEN",
      "active",
      true,
    ]);
  });
  it("rejects invalid material before encryption or database mutation", async () => {
    await expect(updateCursorAuthCache("member", "{}")).rejects.toThrow(
      "access token",
    );
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

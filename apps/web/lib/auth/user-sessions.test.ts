import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
      }),
    }),
  }),
}));
import { legacySessionId, readSessionState } from "./user-sessions";

describe("user sessions", () => {
  it("gives every member one stable, UUID-shaped legacy session id", () => {
    expect(legacySessionId("u1")).toBe(legacySessionId("u1"));
    expect(legacySessionId("u1")).not.toBe(legacySessionId("u2"));
    expect(legacySessionId("u1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("needs a live row for tracked sessions but only an unrevoked one for legacy cookies", async () => {
    mocks.rows = [{ passwordHash: "h", sessionId: null, revokedAt: null }];
    expect((await readSessionState("u", "s1"))?.usable).toBe(false);
    expect((await readSessionState("u", undefined))?.usable).toBe(true);
    mocks.rows = [
      { passwordHash: "h", sessionId: "s1", revokedAt: new Date() },
    ];
    expect((await readSessionState("u", "s1"))?.usable).toBe(false);
    expect((await readSessionState("u", undefined))?.usable).toBe(false);
    mocks.rows = [{ passwordHash: "h", sessionId: "s1", revokedAt: null }];
    expect(await readSessionState("u", "s1")).toMatchObject({
      usable: true,
      passwordHash: "h",
    });
    mocks.rows = [];
    expect(await readSessionState("u", "s1")).toBeNull();
  });
});

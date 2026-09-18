import { afterEach, describe, expect, it, vi } from "vitest";

import { createInviteGrant, openInviteGrant } from "./invite-grant";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("invite grant cookie", () => {
  it("round-trips the invited email and request id", () => {
    vi.stubEnv("AUTH_SECRET", "s".repeat(40));

    const token = createInviteGrant({
      email: "Ada@Example.com",
      requestId: "req-1",
    });

    expect(openInviteGrant(token)).toMatchObject({
      email: "ada@example.com",
      requestId: "req-1",
    });
  });

  it("rejects a tampered payload", () => {
    vi.stubEnv("AUTH_SECRET", "s".repeat(40));
    const token = createInviteGrant({ email: "a@b.com", requestId: "r" });
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from('{"email":"evil@b.com","requestId":"r","expiresAt":9999999999999,"nonce":"x"}', "utf8").toString("base64url")}.${sig}`;

    expect(openInviteGrant(forged)).toBeNull();
    expect(openInviteGrant(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects an expired grant", () => {
    vi.stubEnv("AUTH_SECRET", "s".repeat(40));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = createInviteGrant({ email: "a@b.com", requestId: "r" });

    vi.setSystemTime(new Date("2026-01-01T02:00:01Z"));
    expect(openInviteGrant(token)).toBeNull();
  });

  it("returns null for malformed input", () => {
    vi.stubEnv("AUTH_SECRET", "s".repeat(40));
    expect(openInviteGrant(undefined)).toBeNull();
    expect(openInviteGrant("")).toBeNull();
    expect(openInviteGrant("no-dot")).toBeNull();
  });
});

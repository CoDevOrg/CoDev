import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openTicket, sealTicket } from "./signed-ticket";

describe("signed tickets", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("opens a ticket sealed for the same purpose", () => {
    const ticket = sealTicket("a", { userId: "u1" }, 60_000);
    expect(openTicket<{ userId: string }>("a", ticket)?.userId).toBe("u1");
  });

  it("rejects another purpose, tampering, and expiry", () => {
    const ticket = sealTicket("a", { userId: "u1" }, 60_000);
    expect(openTicket("b", ticket)).toBeNull();
    const [payload, signature] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        userId: "u2",
        expiresAt: Date.now() + 1000,
        nonce: "x",
      }),
    ).toString("base64url");
    expect(openTicket("a", `${forged}.${signature}`)).toBeNull();
    expect(openTicket("a", `${payload}.${signature}.extra`)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(openTicket("a", ticket)).toBeNull();
  });

  it("rejects tickets signed with another secret", () => {
    const ticket = sealTicket("a", { userId: "u1" }, 60_000);
    vi.stubEnv("AUTH_SECRET", "other-secret");
    expect(openTicket("a", ticket)).toBeNull();
  });
});

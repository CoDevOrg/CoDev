import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mintCoordinationToken,
  openCoordinationToken,
} from "./cli-agent-session";

const INPUT = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
};

describe("coordination token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-value";
  });
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("round-trips a freshly minted token", () => {
    const opened = openCoordinationToken(mintCoordinationToken(INPUT));
    expect(opened).toMatchObject(INPUT);
    expect(opened?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload", () => {
    const [payload, signature] = mintCoordinationToken(INPUT).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...INPUT, sessionId: "44444444-4444-4444-8444-444444444444" }),
      "utf8",
    ).toString("base64url");
    expect(openCoordinationToken(`${forged}.${signature}`)).toBeNull();
    expect(openCoordinationToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintCoordinationToken(INPUT);
    process.env.AUTH_SECRET = "a-different-secret";
    expect(openCoordinationToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintCoordinationToken(INPUT);
    const [payload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    decoded.expiresAt = Date.now() - 1;
    const staleRepack = Buffer.from(JSON.stringify(decoded), "utf8").toString(
      "base64url",
    );
    // Re-sign so only expiry, not the signature, is what fails.
    const sig = createHmac("sha256", "test-secret-value")
      .update(`codev-coordination-mcp-v1.${staleRepack}`)
      .digest("base64url");
    expect(openCoordinationToken(`${staleRepack}.${sig}`)).toBeNull();
  });

  it("returns null for junk", () => {
    expect(openCoordinationToken(undefined)).toBeNull();
    expect(openCoordinationToken("")).toBeNull();
    expect(openCoordinationToken("no-dot")).toBeNull();
    expect(openCoordinationToken("a.b.c")).toBeNull();
  });
});

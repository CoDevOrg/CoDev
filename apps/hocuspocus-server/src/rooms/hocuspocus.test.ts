import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  verifyWorkspaceToken,
  workspaceFileDocumentWorkspaceId,
} from "./hocuspocus";

const originalSecret = process.env.HOCUSPOCUS_TOKEN_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.HOCUSPOCUS_TOKEN_SECRET;
  } else {
    process.env.HOCUSPOCUS_TOKEN_SECRET = originalSecret;
  }
});

function tokenFor(
  workspaceId: string,
  userId: string,
  userName: string,
  secret: string,
  expiresAt = Date.now() + 60_000,
) {
  const payload = Buffer.from(
    JSON.stringify({ workspaceId, userId, userName, canEdit: true, expiresAt }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

describe("Hocuspocus workspace token verification", () => {
  it("accepts signed workspace identity tokens", () => {
    const secret = "a".repeat(32);
    process.env.HOCUSPOCUS_TOKEN_SECRET = secret;
    expect(
      verifyWorkspaceToken(tokenFor("workspace-1", "user-1", "Ada", secret)),
    ).toEqual({
      workspaceId: "workspace-1",
      userId: "user-1",
      userName: "Ada",
      canEdit: true,
      expiresAt: expect.any(Number),
    });
  });

  it("rejects missing or tampered tokens", () => {
    process.env.HOCUSPOCUS_TOKEN_SECRET = "a".repeat(32);
    expect(verifyWorkspaceToken(null)).toBeNull();
    expect(verifyWorkspaceToken("invalid.token")).toBeNull();
  });

  it("rejects expired collaboration tokens", () => {
    const secret = "a".repeat(32);
    process.env.HOCUSPOCUS_TOKEN_SECRET = secret;
    expect(
      verifyWorkspaceToken(
        tokenFor("workspace-1", "user-1", "Ada", secret, Date.now() - 1),
      ),
    ).toBeNull();
  });
});

describe("Hocuspocus document namespace", () => {
  it("allows file documents but reserves the durable state document", () => {
    const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
    expect(
      workspaceFileDocumentWorkspaceId(`workspace:${workspaceId}:src/app.ts`),
    ).toBe(workspaceId);
    expect(
      workspaceFileDocumentWorkspaceId(`workspace:${workspaceId}:state`),
    ).toBeNull();
    expect(
      workspaceFileDocumentWorkspaceId(`workspace:${workspaceId}:STATE`),
    ).toBeNull();
    expect(
      workspaceFileDocumentWorkspaceId("workspace:not-a-uuid:file"),
    ).toBeNull();
  });
});

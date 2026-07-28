import { beforeEach, describe, expect, it } from "vitest";

import {
  createInviteToken,
  decryptSecret,
  encryptSecret,
  hashInviteToken,
  inviteTokenMatches,
} from "./crypto";

describe("secret protection", () => {
  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
  });

  it("encrypts values with authenticated encryption", () => {
    const encrypted = encryptSecret("sk-test-secret");

    expect(encrypted).not.toContain("sk-test-secret");
    expect(decryptSecret(encrypted)).toBe("sk-test-secret");
  });

  it("hashes invite tokens before persistence", () => {
    const token = createInviteToken();
    const hash = hashInviteToken(token);

    expect(hash).toHaveLength(64);
    expect(inviteTokenMatches(token, hash)).toBe(true);
    expect(inviteTokenMatches(`${token}x`, hash)).toBe(false);
  });
});

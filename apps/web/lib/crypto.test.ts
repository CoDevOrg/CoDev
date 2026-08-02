import { beforeEach, describe, expect, it } from "vitest";

import {
  createInviteToken,
  decryptSecret,
  hashPassword,
  encryptSecret,
  hashInviteToken,
  inviteTokenMatches,
  verifyPassword,
} from "./crypto";

describe("secret protection", () => {
  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
  });

  it("encrypts values with authenticated encryption", async () => {
    const encrypted = await encryptSecret("sk-test-secret");

    expect(encrypted).not.toContain("sk-test-secret");
    await expect(decryptSecret(encrypted)).resolves.toBe("sk-test-secret");
  });

  it("hashes invite tokens before persistence", () => {
    const token = createInviteToken();
    const hash = hashInviteToken(token);

    expect(hash).toHaveLength(64);
    expect(inviteTokenMatches(token, hash)).toBe(true);
    expect(inviteTokenMatches(`${token}x`, hash)).toBe(false);
  });

  it("hashes and verifies passwords without storing the password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});

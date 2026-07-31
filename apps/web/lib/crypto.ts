import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export { decryptSecret, encryptSecret } from "./kms";

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashInviteToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createInviteToken() {
  return randomBytes(32).toString("base64url");
}

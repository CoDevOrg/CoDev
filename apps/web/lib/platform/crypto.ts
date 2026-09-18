import "server-only";

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

export { decryptSecret, encryptSecret } from "./kms";

const scrypt = promisify(scryptCallback);
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

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

export async function hashPassword(password: string) {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = (await scrypt(
    password,
    salt,
    PASSWORD_KEY_BYTES,
  )) as Buffer;

  return `${salt.toString("base64url")}.${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [encodedSalt, encodedHash] = storedHash.split(".");
  if (!encodedSalt || !encodedHash) return false;

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

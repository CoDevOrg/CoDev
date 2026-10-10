import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 defaults every authenticator app supports: SHA-1, 6 digits, 30 s.
const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept the previous and next step to tolerate clock drift and typing time.
const DRIFT_STEPS = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(text: string) {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new 160-bit secret, base32-encoded for authenticator apps. */
export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function totpStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Strips spaces so "123 456" from a phone app still matches. */
export function normalizeTotpInput(code: string) {
  return code.replace(/\s/g, "");
}

/**
 * The step a code matches, or null. Steps at or before `lastUsedStep` are
 * refused, so an intercepted code cannot be replayed within its window.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  lastUsedStep: number | null,
  nowMs = Date.now(),
) {
  const input = normalizeTotpInput(code);
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(input)) return null;
  const current = totpStep(nowMs);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta += 1) {
    const step = current + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (
      timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(input))
    )
      return step;
  }
  return null;
}

export function totpUri(secret: string, accountName: string) {
  const issuer = "CoDev";
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

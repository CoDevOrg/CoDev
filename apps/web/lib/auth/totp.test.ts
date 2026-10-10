import { describe, expect, it } from "vitest";

import {
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  matchTotpStep,
  totpCode,
  totpStep,
  totpUri,
} from "./totp";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890", truncated to 6 digits.
const RFC_SECRET = encodeBase32(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC 6238 vector at %i seconds", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(expected);
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    expect(decodeBase32(generateTotpSecret())).toHaveLength(20);
  });

  it("accepts one step of drift and spaces in the input", () => {
    const now = 1_700_000_000_000;
    const previous = totpCode(RFC_SECRET, totpStep(now) - 1);
    expect(
      matchTotpStep(
        RFC_SECRET,
        `${previous.slice(0, 3)} ${previous.slice(3)}`,
        null,
        now,
      ),
    ).toBe(totpStep(now) - 1);
    expect(
      matchTotpStep(
        RFC_SECRET,
        totpCode(RFC_SECRET, totpStep(now) - 2),
        null,
        now,
      ),
    ).toBeNull();
  });

  it("refuses a code from an already-used step", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, totpStep(now));
    expect(matchTotpStep(RFC_SECRET, code, totpStep(now), now)).toBeNull();
    expect(matchTotpStep(RFC_SECRET, code, totpStep(now) - 1, now)).toBe(
      totpStep(now),
    );
  });

  it("rejects malformed input", () => {
    expect(matchTotpStep(RFC_SECRET, "12345", null)).toBeNull();
    expect(matchTotpStep(RFC_SECRET, "abcdef", null)).toBeNull();
  });

  it("builds an otpauth URI authenticator apps accept", () => {
    const uri = new URL(totpUri("ABC", "me@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/CoDev:me@example.com");
    expect(uri.searchParams.get("issuer")).toBe("CoDev");
  });
});

import { createHmac, timingSafeEqual } from "node:crypto";

function signature(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Account verification is unavailable.");
  return createHmac("sha256", secret)
    .update(`account-deletion:${payload}`)
    .digest("base64url");
}

export function createAccountDeletionToken(userId: string, email: string) {
  const payload = Buffer.from(
    JSON.stringify({ userId, email, expiresAt: Date.now() + 15 * 60_000 }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyAccountDeletionToken(
  token: string,
  userId: string,
  email: string,
) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || token.length > 2048) return false;
    const [payload, signed] = parts;
    if (!payload || !signed) return false;
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(signed);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const state = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return (
      state.userId === userId &&
      state.email === email &&
      Number.isFinite(state.expiresAt) &&
      state.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}

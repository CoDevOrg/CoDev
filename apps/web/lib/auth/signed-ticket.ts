import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type Sealed = { expiresAt: number; nonce: string };

function sign(purpose: string, payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for signed tickets.");
  // The purpose is part of the MAC, so a ticket minted for one flow can
  // never be redeemed by another.
  return createHmac("sha256", secret)
    .update(`${purpose}:${payload}`)
    .digest("base64url");
}

/** An HMAC-signed, expiring value. It is authenticated, not encrypted. */
export function sealTicket<T extends object>(
  purpose: string,
  data: T,
  ttlMs: number,
) {
  const body: T & Sealed = {
    ...data,
    expiresAt: Date.now() + ttlMs,
    nonce: randomBytes(12).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(purpose, payload)}`;
}

export function openTicket<T extends object>(
  purpose: string,
  value: unknown,
): (T & Sealed) | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  let expected: Buffer;
  try {
    expected = Buffer.from(sign(purpose, payload), "base64url");
  } catch {
    return null;
  }
  const provided = Buffer.from(signature, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }
  try {
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<Sealed>;
    return typeof body.expiresAt === "number" && body.expiresAt > Date.now()
      ? (body as T & Sealed)
      : null;
  } catch {
    return null;
  }
}

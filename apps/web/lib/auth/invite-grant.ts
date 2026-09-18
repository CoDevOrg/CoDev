import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A short-lived, signed cookie that says "this browser followed a valid invite
 * link". It survives the OAuth round-trip (Google/GitHub) where form state does
 * not, so an invited person can finish sign-up with any provider — including a
 * GitHub account whose email is private or different from the invited address.
 *
 * Mirrors the signing scheme used for the GitHub-link cookie.
 */

const GRANT_TTL_MS = 60 * 60 * 1000;

export const INVITE_GRANT_COOKIE = "codev-invite-grant";

export type InviteGrant = {
  /** The address the invitation was sent to (lower-cased). */
  email: string;
  /** `access_requests.id` the grant was minted from. */
  requestId: string;
  expiresAt: number;
  nonce: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret)
    throw new Error("AUTH_SECRET is required to mint invite grants.");
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signatureFor(payload: string) {
  return createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
}

export function createInviteGrant(input: {
  email: string;
  requestId: string;
}): string {
  const grant: InviteGrant = {
    email: input.email.trim().toLowerCase(),
    requestId: input.requestId,
    expiresAt: Date.now() + GRANT_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = encode(JSON.stringify(grant));
  return `${payload}.${signatureFor(payload)}`;
}

export function openInviteGrant(value: string | undefined): InviteGrant | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) return null;

  const expected = Buffer.from(signatureFor(payload), "base64url");
  const provided = Buffer.from(providedSignature, "base64url");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const grant = JSON.parse(decode(payload)) as Partial<InviteGrant>;
    if (
      typeof grant.email !== "string" ||
      !grant.email ||
      typeof grant.requestId !== "string" ||
      !grant.requestId ||
      typeof grant.expiresAt !== "number" ||
      grant.expiresAt <= Date.now() ||
      typeof grant.nonce !== "string" ||
      !grant.nonce
    ) {
      return null;
    }
    return grant as InviteGrant;
  } catch {
    return null;
  }
}

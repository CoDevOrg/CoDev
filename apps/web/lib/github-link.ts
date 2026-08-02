import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const LINK_STATE_TTL_MS = 10 * 60 * 1000;

export const GITHUB_LINK_COOKIE = "codev-github-link";

export type GitHubLinkState = {
  userId: string;
  returnTo: string;
  expiresAt: number;
  nonce: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for GitHub linking.");
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

function isSafeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

export function createGithubLinkState(userId: string, returnTo: string) {
  const safeReturnTo = isSafeReturnTo(returnTo) ? returnTo : "/dashboard";
  const state: GitHubLinkState = {
    userId,
    returnTo: safeReturnTo,
    expiresAt: Date.now() + LINK_STATE_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = encode(JSON.stringify(state));
  return `${payload}.${signatureFor(payload)}`;
}

export function openGithubLinkState(value: string): GitHubLinkState | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) return null;

  const expectedSignature = signatureFor(payload);
  const provided = Buffer.from(providedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const state = JSON.parse(decode(payload)) as Partial<GitHubLinkState>;
    if (
      typeof state.userId !== "string" ||
      !state.userId ||
      typeof state.returnTo !== "string" ||
      !isSafeReturnTo(state.returnTo) ||
      typeof state.expiresAt !== "number" ||
      state.expiresAt <= Date.now() ||
      typeof state.nonce !== "string" ||
      !state.nonce
    ) {
      return null;
    }
    return state as GitHubLinkState;
  } catch {
    return null;
  }
}

import "server-only";

import { saveProviderCredential } from "./credentials";
import { logEvent } from "../platform/observability";

const CLAUDE_TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const CLAUDE_SECRET_IN_TEXT = /sk-ant-[A-Za-z0-9_-]{12,}/g;

/**
 * Strip Claude tokens from free text before it is persisted (e.g. a session's
 * `failureReason`) or logged. The runner captures `claude setup-token` stdout,
 * which contains the token verbatim, so any string derived from runner output
 * passes through here. Belt-and-braces alongside `observability.redact`.
 */
export function redactClaudeSecrets(text: string): string {
  return text.replace(CLAUDE_SECRET_IN_TEXT, "sk-ant-[REDACTED]");
}

/**
 * A failure connecting a Claude subscription. `status` maps straight to the
 * HTTP response so both the CLI upload route and the first-party web route can
 * surface the same reasons.
 */
export class ClaudeConnectionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ClaudeConnectionError";
  }
}

/**
 * Normalize anything thrown while driving a hosted "Connect Claude" flow into
 * a client-safe {@link ClaudeConnectionError}. A `ClaudeConnectionError` is
 * already a curated, user-facing reason and passes through untouched. Anything
 * else — a failed DB query (raw SQL + params), a runner crash, a stack trace —
 * is logged server-side and replaced with a generic message so internals never
 * reach the browser.
 */
export function toClaudeConnectionFailure(
  error: unknown,
  event: string,
): ClaudeConnectionError {
  if (error instanceof ClaudeConnectionError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  logEvent("error", event, { detail: redactClaudeSecrets(detail) });
  return new ClaudeConnectionError(
    "Something went wrong on our end while connecting Claude. Try again in a moment.",
    500,
  );
}

export function validateClaudeOAuthToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!CLAUDE_TOKEN_PATTERN.test(token)) {
    throw new ClaudeConnectionError(
      "Claude Code did not return a usable token. Try connecting again.",
    );
  }
  return token;
}

/**
 * Persist a captured Claude Code OAuth token as an Anthropic `OAUTH_TOKEN`
 * credential for the member who connected it.
 */
export async function persistClaudeOAuthToken(input: {
  userId: string;
  oauthToken: string;
}) {
  // The hosted-runner token capture is retired: the browser flow now keeps
  // the subscription in its private runtime (claude-connection-session) and
  // never hands CoDev the token. Only the local CLI's `claude setup-token`
  // upload lands here — Anthropic's long-lived token whose intended use is
  // CLAUDE_CODE_OAUTH_TOKEN on a host, which is exactly what a coding
  // workspace needs. It is stored with `cli` provenance and read only by the
  // workspace-host resolver; it is never a direct-API bearer.
  await saveProviderCredential({
    userId: input.userId,
    provider: "anthropic",
    credentialType: "OAUTH_TOKEN",
    accessToken: input.oauthToken,
    lastFour: input.oauthToken.slice(-4),
    connectedVia: "cli",
  });
  return { scopeType: "USER" as const, scopeId: input.userId };
}

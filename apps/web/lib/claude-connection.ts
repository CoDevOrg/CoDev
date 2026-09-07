import "server-only";

import { saveProviderCredential } from "./credentials";
import { logEvent } from "./observability";
import { requireOrganizationSettingsWrite } from "./settings-access";

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

/**
 * Where the captured token came from. Only affects the human-readable label
 * stored on the credential row.
 */
export type ClaudeConnectionSource = "cli" | "hosted_runner";

const SOURCE_LABEL: Record<ClaudeConnectionSource, string> = {
  cli: "Claude CLI",
  hosted_runner: "Claude account",
};

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
 * Resolve which credential scope a Claude connection lands in. For an
 * organization scope, assert the caller may write shared org settings.
 */
export async function resolveClaudeConnectionScope(input: {
  userId: string;
  scopeType?: unknown;
  organizationId?: unknown;
}): Promise<{ scopeType: "USER" | "ORGANIZATION"; scopeId: string }> {
  const scopeType =
    input.scopeType === "ORGANIZATION" ? "ORGANIZATION" : "USER";
  const scopeId =
    scopeType === "USER"
      ? input.userId
      : typeof input.organizationId === "string"
        ? input.organizationId
        : "";
  if (!scopeId) {
    throw new ClaudeConnectionError("Organization id is required.");
  }
  if (scopeType === "ORGANIZATION") {
    try {
      await requireOrganizationSettingsWrite(input.userId, scopeId);
    } catch {
      throw new ClaudeConnectionError(
        "Only an organization maintainer can connect shared Claude authentication.",
        403,
      );
    }
  }
  return { scopeType, scopeId };
}

/**
 * Persist a captured Claude Code OAuth token as an Anthropic `OAUTH_TOKEN`
 * credential. Shared by the CLI upload path and the hosted-runner path so both
 * land in exactly the same row shape.
 */
export async function persistClaudeOAuthToken(input: {
  scopeType: "USER" | "ORGANIZATION";
  scopeId: string;
  oauthToken: string;
  source: ClaudeConnectionSource;
}) {
  await saveProviderCredential({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    provider: "anthropic",
    credentialType: "OAUTH_TOKEN",
    accessToken: input.oauthToken,
    lastFour: SOURCE_LABEL[input.source],
  });
  return { scopeType: input.scopeType, scopeId: input.scopeId };
}

/**
 * Post-connect health check: confirm the captured token is actually accepted
 * for inference (the OAuth beta + Claude Code identity requirement). Only a
 * hard auth rejection (401/403) fails the connection — a rate-limit or
 * transient 5xx means the token authenticated fine.
 */
export type ClaudeInferenceVerifier = (token: string) => Promise<void>;

export const verifyClaudeInferenceAccess: ClaudeInferenceVerifier = async (
  token,
) => {
  if (process.env.CLAUDE_CONNECTION_SKIP_HEALTHCHECK === "true") return;
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model:
          process.env.CLAUDE_CONNECTION_HEALTHCHECK_MODEL ??
          "claude-3-5-haiku-20241022",
        max_tokens: 1,
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: [{ role: "user", content: "ping" }],
      }),
      cache: "no-store",
    });
  } catch {
    // Network trouble reaching Anthropic — don't fail the connect over it.
    return;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ClaudeConnectionError(
      "Anthropic rejected the connected account for inference. Reconnect and grant access.",
      502,
    );
  }
};

/**
 * Save a Claude connection for a signed-in web user. The token has already
 * been captured (by the hosted runner); this validates it, resolves the
 * scope, and persists it.
 */
export async function saveClaudeConnectionForUser(
  userId: string,
  input: {
    oauthToken?: unknown;
    scopeType?: unknown;
    organizationId?: unknown;
  },
) {
  const { scopeType, scopeId } = await resolveClaudeConnectionScope({
    userId,
    scopeType: input.scopeType,
    organizationId: input.organizationId,
  });
  const oauthToken = validateClaudeOAuthToken(input.oauthToken);
  return persistClaudeOAuthToken({
    scopeType,
    scopeId,
    oauthToken,
    source: "hosted_runner",
  });
}

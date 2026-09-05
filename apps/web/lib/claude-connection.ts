import "server-only";

import { saveProviderCredential } from "./credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const CLAUDE_TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

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

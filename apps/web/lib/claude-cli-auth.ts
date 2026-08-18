import "server-only";

import { authenticateCliRequest, CliAuthError } from "./cli-auth";
import { saveProviderCredential } from "./credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const CLAUDE_TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export function validateClaudeOAuthToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!CLAUDE_TOKEN_PATTERN.test(token)) {
    throw new CliAuthError(
      "Claude Code did not return a usable token. Run `claude setup-token` manually and try again.",
    );
  }
  return token;
}

export async function saveClaudeCliAuth(request: Request) {
  const cli = await authenticateCliRequest(request);
  const input = (await request.json().catch(() => ({}))) as {
    scopeType?: unknown;
    organizationId?: unknown;
    oauthToken?: unknown;
  };
  const scopeType =
    input.scopeType === "ORGANIZATION" ? "ORGANIZATION" : "USER";
  const scopeId =
    scopeType === "USER"
      ? cli.userId
      : typeof input.organizationId === "string"
        ? input.organizationId
        : "";
  if (!scopeId) throw new CliAuthError("Organization id is required.");
  if (scopeType === "ORGANIZATION") {
    try {
      await requireOrganizationSettingsWrite(cli.userId, scopeId);
    } catch {
      throw new CliAuthError(
        "Only an organization maintainer can connect shared Claude Code authentication.",
        403,
      );
    }
  }

  const oauthToken = validateClaudeOAuthToken(input.oauthToken);

  await saveProviderCredential({
    scopeType,
    scopeId,
    provider: "anthropic",
    credentialType: "OAUTH_TOKEN",
    accessToken: oauthToken,
    lastFour: "Claude CLI",
  });
  return { scopeType, scopeId };
}

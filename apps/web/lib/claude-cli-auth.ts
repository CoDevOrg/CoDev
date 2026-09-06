import "server-only";

import {
  ClaudeConnectionError,
  persistClaudeOAuthToken,
  resolveClaudeConnectionScope,
  validateClaudeOAuthToken,
} from "./claude-connection";
import { authenticateCliRequest, CliAuthError } from "./cli-auth";

// Re-exported so existing callers and tests keep their import path.
export { validateClaudeOAuthToken };

export async function saveClaudeCliAuth(request: Request) {
  const cli = await authenticateCliRequest(request);
  const input = (await request.json().catch(() => ({}))) as {
    scopeType?: unknown;
    organizationId?: unknown;
    oauthToken?: unknown;
  };
  try {
    const { scopeType, scopeId } = await resolveClaudeConnectionScope({
      userId: cli.userId,
      scopeType: input.scopeType,
      organizationId: input.organizationId,
    });
    const oauthToken = validateClaudeOAuthToken(input.oauthToken);
    return await persistClaudeOAuthToken({
      scopeType,
      scopeId,
      oauthToken,
      source: "cli",
    });
  } catch (error) {
    // The CLI route renders CliAuthError; keep the status the shared layer chose.
    if (error instanceof ClaudeConnectionError) {
      throw new CliAuthError(error.message, error.status);
    }
    throw error;
  }
}

import "server-only";

import {
  ClaudeConnectionError,
  persistClaudeOAuthToken,
  validateClaudeOAuthToken,
} from "./claude-connection";
import { authenticateCliRequest, CliAuthError } from "../auth/cli-auth";

// Re-exported so existing callers and tests keep their import path.
export { validateClaudeOAuthToken };

export async function saveClaudeCliAuth(request: Request) {
  const cli = await authenticateCliRequest(request);
  const input = (await request.json().catch(() => ({}))) as {
    oauthToken?: unknown;
  };
  try {
    const oauthToken = validateClaudeOAuthToken(input.oauthToken);
    return await persistClaudeOAuthToken({
      userId: cli.userId,
      oauthToken,
    });
  } catch (error) {
    // The CLI route renders CliAuthError; keep the status the shared layer chose.
    if (error instanceof ClaudeConnectionError) {
      throw new CliAuthError(error.message, error.status);
    }
    throw error;
  }
}

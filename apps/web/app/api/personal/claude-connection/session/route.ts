import { apiError, getApiUser } from "@/lib/http/api";
import { toClaudeConnectionFailure } from "@/lib/providers/claude-connection";
import { startClaudeConnectionSession } from "@/lib/providers/claude-connection-session";
import { resolveClaudeRunner } from "@/lib/providers/claude-connection-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Begin a hosted "Connect Claude" flow: provisions a runner, starts
 * `claude setup-token`, and returns the authorization URL the member opens.
 */
export async function POST() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    return Response.json(
      await startClaudeConnectionSession(
        { userId: user.id },
        resolveClaudeRunner(),
      ),
    );
  } catch (error) {
    const failure = toClaudeConnectionFailure(
      error,
      "claude_connection.session_start_failed",
    );
    return apiError(failure, failure.status);
  }
}

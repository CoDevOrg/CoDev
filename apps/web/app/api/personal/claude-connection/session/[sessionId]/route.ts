import { apiError, getApiUser } from "@/lib/api";
import { toClaudeConnectionFailure } from "@/lib/claude-connection";
import { getClaudeConnectionSession } from "@/lib/claude-connection-session";
import { resolveClaudeRunner } from "@/lib/claude-connection-runner";

export const runtime = "nodejs";

/**
 * Poll a connection session. Drives the runner forward: on a captured token
 * this persists the Anthropic credential and returns `status: "connected"`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const { sessionId } = await context.params;
    return Response.json(
      await getClaudeConnectionSession(
        { userId: user.id, sessionId },
        resolveClaudeRunner(),
      ),
    );
  } catch (error) {
    const failure = toClaudeConnectionFailure(
      error,
      "claude_connection.session_poll_failed",
    );
    return apiError(failure, failure.status);
  }
}

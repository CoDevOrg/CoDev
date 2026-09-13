import { apiError, getApiUser } from "@/lib/api";
import { toClaudeConnectionFailure } from "@/lib/claude-connection";
import {
  cancelClaudeConnectionSession,
  getClaudeConnectionSession,
} from "@/lib/claude-connection-session";

export const runtime = "nodejs";

/**
 * Poll official login and retain only the runtime reference on success.
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
      await getClaudeConnectionSession({ userId: user.id, sessionId }),
    );
  } catch (error) {
    const failure = toClaudeConnectionFailure(
      error,
      "claude_connection.session_poll_failed",
    );
    return apiError(failure, failure.status);
  }
}

/** Stop an abandoned connection attempt and release its hosted runner. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const { sessionId } = await context.params;
    return Response.json(
      await cancelClaudeConnectionSession({ userId: user.id, sessionId }),
    );
  } catch (error) {
    const failure = toClaudeConnectionFailure(
      error,
      "claude_connection.session_cancel_failed",
    );
    return apiError(failure, failure.status);
  }
}

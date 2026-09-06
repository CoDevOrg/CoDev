import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { ClaudeConnectionError } from "@/lib/claude-connection";
import { startClaudeConnectionSession } from "@/lib/claude-connection-session";
import { resolveClaudeRunner } from "@/lib/claude-connection-runner";

export const runtime = "nodejs";

const postSchema = z.object({
  scopeType: z.enum(["USER", "ORGANIZATION"]).optional(),
  organizationId: z.string().trim().min(1).optional(),
});

/**
 * Begin a hosted "Connect Claude" flow: provisions a runner, starts
 * `claude setup-token`, and returns the authorization URL the member opens.
 */
export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = postSchema.parse(await request.json().catch(() => ({})));
    return Response.json(
      await startClaudeConnectionSession(
        { userId: user.id, ...input },
        resolveClaudeRunner(),
      ),
    );
  } catch (error) {
    if (error instanceof ClaudeConnectionError) {
      return apiError(error, error.status);
    }
    return apiError(error);
  }
}

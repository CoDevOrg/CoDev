import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { toClaudeConnectionFailure } from "@/lib/claude-connection";
import { submitClaudeConnectionCode } from "@/lib/claude-connection-session";

export const runtime = "nodejs";

const postSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/),
});

/** Hand the authorization code the member copied from Anthropic to the runner. */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const { sessionId } = await context.params;
    const { code } = postSchema.parse(await request.json());
    return Response.json(
      await submitClaudeConnectionCode({ userId: user.id, sessionId, code }),
    );
  } catch (error) {
    const failure = toClaudeConnectionFailure(
      error,
      "claude_connection.code_submit_failed",
    );
    return apiError(failure, failure.status);
  }
}

import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  ClaudeConnectionError,
  saveClaudeConnectionForUser,
} from "@/lib/claude-connection";

export const runtime = "nodejs";

const postSchema = z.object({
  oauthToken: z.string().trim().min(1),
  scopeType: z.enum(["USER", "ORGANIZATION"]).optional(),
  organizationId: z.string().trim().min(1).optional(),
});

/**
 * First-party save for a Claude subscription connection: the hosted runner (or
 * a manual paste) has already captured a `claude setup-token` result, and this
 * stores it against the signed-in member — no CoDev CLI device token required.
 */
export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = postSchema.parse(await request.json());
    await saveClaudeConnectionForUser(user.id, input);
  } catch (error) {
    if (error instanceof ClaudeConnectionError) {
      return apiError(error, error.status);
    }
    return apiError(error);
  }
}

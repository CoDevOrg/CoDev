import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { submitAgentBugReport } from "@/lib/agent-bug-report";
import { consumeRateLimit } from "@/lib/rate-limit";

const inputSchema = z.object({
  userAgent: z.string().max(512),
  cycles: z
    .array(
      z.object({
        prompt: z.string().max(20_000),
        response: z.string().max(40_000),
      }),
    )
    .max(5),
  terminalErrors: z.array(z.string().max(4_000)).max(20),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
    const limit = await consumeRateLimit(
      user.id,
      "agent-bug-report",
      5,
      60 * 60,
    );
    if (!limit.allowed) {
      return Response.json(
        { error: "Bug report limit reached. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }
    const input = inputSchema.parse(await request.json());
    const reportId = crypto.randomUUID();
    await submitAgentBugReport({
      reportId,
      workspaceId,
      userId: user.id,
      ...input,
    });
    return Response.json({ reportId }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}

import { z } from "zod";

import { withWorkspace } from "@/lib/http/api-route";
import { submitAgentBugReport } from "@/lib/agents/agent-bug-report";
import { consumeRateLimit } from "@/lib/platform/rate-limit";

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

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) => {
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
  },
);

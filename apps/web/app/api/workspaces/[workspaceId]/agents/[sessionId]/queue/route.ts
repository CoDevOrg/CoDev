import { z } from "zod";

import { withWorkspace } from "@/lib/http/api-route";
import { enqueueSharedSessionInstruction } from "@/lib/chat/shared-session-server";

const inputSchema = z.object({
  prompt: z.string().min(1).max(20_000),
});

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ request, user, workspaceId, params: { sessionId } }) => {
    const input = inputSchema.parse(await request.json());
    return Response.json(
      await enqueueSharedSessionInstruction(
        workspaceId,
        sessionId,
        user,
        input.prompt,
      ),
    );
  },
);

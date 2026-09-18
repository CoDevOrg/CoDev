import { z } from "zod";

import { withWorkspace } from "@/lib/http/api-route";
import { selectSharedSessionProvider } from "@/lib/chat/shared-session-server";

const inputSchema = z.object({
  provider: z.enum(["openai", "restricted"]),
});

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ request, user, workspaceId, params: { sessionId } }) => {
    const input = inputSchema.parse(await request.json());
    return Response.json(
      await selectSharedSessionProvider(
        workspaceId,
        sessionId,
        user,
        input.provider,
      ),
    );
  },
);

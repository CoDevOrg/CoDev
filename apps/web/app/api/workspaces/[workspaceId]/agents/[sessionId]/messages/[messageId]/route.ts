import { z } from "zod";

import { updateCoordinationMessageStatus } from "@/lib/coordination/agent-coordination";
import { withWorkspace } from "@/lib/http/api-route";

const inputSchema = z.object({
  status: z.enum(["delivered", "resolved"]),
});

export const PATCH = withWorkspace<{
  workspaceId: string;
  sessionId: string;
  messageId: string;
}>("coSteer", async ({ request, workspaceId, params }) => {
  const input = inputSchema.parse(await request.json());
  return Response.json({
    message: await updateCoordinationMessageStatus(
      workspaceId,
      params.sessionId,
      params.messageId,
      input.status,
    ),
  });
});

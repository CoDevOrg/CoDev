import { withWorkspace } from "@/lib/http/api-route";
import { interruptSharedSession } from "@/lib/chat/shared-session-server";

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ user, workspaceId, params: { sessionId } }) =>
    Response.json(await interruptSharedSession(workspaceId, sessionId, user)),
  { anyAuth: true },
);

import { withWorkspace } from "@/lib/api-route";
import { interruptSharedSession } from "@/lib/shared-session-server";

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ user, workspaceId, params: { sessionId } }) =>
    Response.json(await interruptSharedSession(workspaceId, sessionId, user)),
  { anyAuth: true },
);

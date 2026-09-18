import { withWorkspace } from "@/lib/http/api-route";
import { startControlledSharedSessionTurn } from "@/lib/chat/shared-session-server";

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ user, workspaceId, params: { sessionId } }) =>
    Response.json(
      await startControlledSharedSessionTurn(workspaceId, sessionId, user),
    ),
);

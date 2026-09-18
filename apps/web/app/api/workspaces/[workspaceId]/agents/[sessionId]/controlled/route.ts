import { withWorkspace } from "@/lib/api-route";
import { startControlledSharedSessionTurn } from "@/lib/shared-session-server";

export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ user, workspaceId, params: { sessionId } }) =>
    Response.json(
      await startControlledSharedSessionTurn(workspaceId, sessionId, user),
    ),
);

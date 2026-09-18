import { withWorkspace } from "@/lib/http/api-route";
import { cancelWorkspacePathClaim } from "@/lib/coordination/path-claims-server";

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) =>
    Response.json(
      await cancelWorkspacePathClaim(workspaceId, user, await request.json()),
    ),
);

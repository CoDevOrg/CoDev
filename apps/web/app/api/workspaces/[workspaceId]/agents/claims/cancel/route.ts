import { withWorkspace } from "@/lib/api-route";
import { cancelWorkspacePathClaim } from "@/lib/path-claims-server";

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) =>
    Response.json(
      await cancelWorkspacePathClaim(workspaceId, user, await request.json()),
    ),
);

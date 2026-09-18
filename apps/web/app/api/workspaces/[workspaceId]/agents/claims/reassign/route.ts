import { withWorkspace } from "@/lib/api-route";
import { reassignWorkspacePathClaim } from "@/lib/path-claims-server";

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) =>
    Response.json(
      await reassignWorkspacePathClaim(workspaceId, user, await request.json()),
    ),
);

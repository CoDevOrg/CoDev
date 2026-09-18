import { withWorkspace } from "@/lib/http/api-route";
import { reassignWorkspacePathClaim } from "@/lib/coordination/path-claims-server";

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) =>
    Response.json(
      await reassignWorkspacePathClaim(workspaceId, user, await request.json()),
    ),
);

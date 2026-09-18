import { withWorkspace } from "@/lib/http/api-route";
import {
  createWorkspacePathClaim,
  loadPathClaimsSnapshot,
} from "@/lib/coordination/path-claims-server";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadPathClaimsSnapshot(workspaceId, user)),
);

// A conflicting claim throws CoordinationConflictError, which carries 409.
export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) =>
    Response.json(
      await createWorkspacePathClaim(workspaceId, user, await request.json()),
      { status: 201 },
    ),
);

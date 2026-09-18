import { withWorkspace } from "@/lib/api-route";
import {
  createWorkspacePathClaim,
  loadPathClaimsSnapshot,
} from "@/lib/path-claims-server";

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

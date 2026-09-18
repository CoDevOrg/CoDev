import { withWorkspace } from "@/lib/api-route";
import { loadWorkspaceCoordinationSnapshot } from "@/lib/coordination-snapshot-server";

/**
 * The live claims and overlaps behind Mission Control's collision banner.
 * Read-only, so `view` is enough — seeing that two agents are on the same file
 * is exactly what a viewer is in the workspace for.
 */
export const GET = withWorkspace("view", async ({ workspaceId }) =>
  Response.json(await loadWorkspaceCoordinationSnapshot(workspaceId)),
);

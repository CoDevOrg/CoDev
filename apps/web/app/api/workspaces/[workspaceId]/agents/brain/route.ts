import { withWorkspace } from "@/lib/api-route";
import {
  listBrainEntries,
  listWorkspaceBriefs,
  listWorkspaceOverlaps,
} from "@/lib/workspace-brain";

/**
 * The read model Mission Control renders: every live agent's brief, the
 * open overlap warnings between them, and the recent workspace history.
 */
export const GET = withWorkspace("view", async ({ workspaceId }) => {
  const [briefs, overlaps, entries] = await Promise.all([
    listWorkspaceBriefs(workspaceId),
    listWorkspaceOverlaps(workspaceId),
    listBrainEntries(workspaceId, { limit: 40 }),
  ]);
  return Response.json({ briefs, overlaps, entries });
});

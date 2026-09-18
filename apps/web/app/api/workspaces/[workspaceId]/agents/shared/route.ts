import { withWorkspace } from "@/lib/api-route";
import { loadSharedSessionSnapshot } from "@/lib/shared-session-server";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadSharedSessionSnapshot(workspaceId, user)),
);

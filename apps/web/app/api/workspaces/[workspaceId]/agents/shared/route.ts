import { withWorkspace } from "@/lib/http/api-route";
import { loadSharedSessionSnapshot } from "@/lib/chat/shared-session-server";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadSharedSessionSnapshot(workspaceId, user)),
);

import { withWorkspace } from "@/lib/http/api-route";
import { loadWorkboardSnapshot } from "@/lib/coordination/workboard-server";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadWorkboardSnapshot(workspaceId, user)),
);

import { withWorkspace } from "@/lib/api-route";
import { loadWorkboardSnapshot } from "@/lib/workboard-server";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadWorkboardSnapshot(workspaceId, user)),
);

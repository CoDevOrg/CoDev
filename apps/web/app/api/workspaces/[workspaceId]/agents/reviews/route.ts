import { withWorkspace } from "@/lib/http/api-route";
import {
  applyWorkspaceReviewAction,
  loadReviewSnapshot,
} from "@/lib/agents/review-checkpoint-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";

export const maxDuration = 300;

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await loadReviewSnapshot(workspaceId, user)),
);

export const POST = withWorkspace(
  "review",
  async ({ request, user, workspaceId }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id, "review");
    return Response.json(
      await applyWorkspaceReviewAction(workspaceId, user, await request.json()),
    );
  },
);

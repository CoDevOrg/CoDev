import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { ReviewActionError } from "@/lib/agent-review";
import { OrchestratorError } from "@/lib/orchestrator";
import {
  loadReviewSnapshot,
  prepareWorkspaceReview,
} from "@/lib/review-checkpoint-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

export const maxDuration = 300;

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    return Response.json(await loadReviewSnapshot(workspaceId, user));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "review");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id, "review");
    return Response.json(
      await prepareWorkspaceReview(workspaceId, user, await request.json()),
    );
  } catch (error) {
    if (error instanceof ReviewActionError)
      return apiError(error, error.status);
    if (error instanceof OrchestratorError) {
      return Response.json(
        { error: error.message, conflictPaths: error.conflictPaths },
        { status: error.status },
      );
    }
    return apiError(error);
  }
}

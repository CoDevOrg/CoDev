import { createPublicationSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import {
  exportWorkspaceToPullRequest,
  GitHubExportError,
} from "@/lib/github-export";
import { PublicationError } from "@/lib/github-publication";
import { PullRequestError } from "@/lib/github-pull-request";
import { requestId } from "@/lib/observability";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const parsed = createPublicationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Invalid export request."), 400);
  }
  const { workspaceId } = await params;
  try {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const result = await exportWorkspaceToPullRequest({
      workspaceId,
      userId: user.id,
      branchName: parsed.data.branchName,
      expectedHeadSha: parsed.data.expectedHeadSha,
      requestId: requestId(request),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const status =
      error instanceof GitHubExportError ||
      error instanceof PublicationError ||
      error instanceof PullRequestError
        ? error.status
        : 502;
    return apiError(error, status);
  }
}

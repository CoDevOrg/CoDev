import { createPullRequestSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import {
  openWorkspacePullRequest,
  PullRequestError,
} from "@/lib/github-pull-request";
import { requestId } from "@/lib/observability";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const parsed = createPullRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Invalid pull request."), 400);
  }
  const { workspaceId } = await params;
  try {
    const pullRequest = await openWorkspacePullRequest({
      workspaceId,
      userId: user.id,
      branchName: parsed.data.branchName,
      title: parsed.data.title,
      body: parsed.data.body,
      requestId: requestId(request),
    });
    return Response.json({ pullRequest }, { status: 201 });
  } catch (error) {
    return apiError(
      error,
      error instanceof PullRequestError ? error.status : 502,
    );
  }
}

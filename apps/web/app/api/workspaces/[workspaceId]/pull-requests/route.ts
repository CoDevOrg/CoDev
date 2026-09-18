import { createPullRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import { openWorkspacePullRequest } from "@/lib/github/github-pull-request";
import { requestId } from "@/lib/platform/observability";

// PullRequestError carries its own status; anything else is an upstream failure.
export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(
      request,
      createPullRequestSchema,
      "Invalid pull request.",
    );
    const pullRequest = await openWorkspacePullRequest({
      workspaceId,
      userId: user.id,
      branchName: input.branchName,
      title: input.title,
      body: input.body,
      requestId: requestId(request),
    });
    return Response.json({ pullRequest }, { status: 201 });
  },
  { errorStatus: 502 },
);

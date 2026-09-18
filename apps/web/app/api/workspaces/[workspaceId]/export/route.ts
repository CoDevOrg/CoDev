import { createPublicationSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/api-route";
import { exportWorkspaceToPullRequest } from "@/lib/github-export";
import { requestId } from "@/lib/observability";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

// GitHub export, publication and pull request errors carry their own status;
// anything else is an upstream failure.
export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(
      request,
      createPublicationSchema,
      "Invalid export request.",
    );
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const result = await exportWorkspaceToPullRequest({
      workspaceId,
      userId: user.id,
      branchName: input.branchName,
      expectedHeadSha: input.expectedHeadSha,
      requestId: requestId(request),
    });
    return Response.json(result, { status: 201 });
  },
  { errorStatus: 502 },
);

import { createPublicationSchema } from "@codev/contracts";

import { readJson, withUser, withWorkspace } from "@/lib/api-route";
import {
  listWorkspacePublications,
  publishWorkspaceBranch,
} from "@/lib/github-publication";
import { requestId } from "@/lib/observability";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

// PublicationError carries its own status; anything else is an upstream failure.
export const GET = withWorkspace(
  "view",
  async ({ user, workspaceId }) =>
    Response.json({
      publications: await listWorkspacePublications(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);

export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(
      request,
      createPublicationSchema,
      "Invalid publication request.",
    );
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const publication = await publishWorkspaceBranch({
      workspaceId,
      userId: user.id,
      branchName: input.branchName,
      expectedHeadSha: input.expectedHeadSha,
      requestId: requestId(request),
    });
    return Response.json({ publication }, { status: 201 });
  },
  { errorStatus: 502 },
);

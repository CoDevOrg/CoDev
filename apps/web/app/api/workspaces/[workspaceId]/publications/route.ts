import { createPublicationSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  listWorkspacePublications,
  PublicationError,
  publishWorkspaceBranch,
} from "@/lib/github-publication";
import { requestId } from "@/lib/observability";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const publications = await listWorkspacePublications(workspaceId, user.id);
    return Response.json({ publications });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}

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
    return apiError(new Error("Invalid publication request."), 400);
  }
  const { workspaceId } = await params;
  try {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const publication = await publishWorkspaceBranch({
      workspaceId,
      userId: user.id,
      branchName: parsed.data.branchName,
      expectedHeadSha: parsed.data.expectedHeadSha,
      requestId: requestId(request),
    });
    return Response.json({ publication }, { status: 201 });
  } catch (error) {
    return apiError(
      error,
      error instanceof PublicationError ? error.status : 502,
    );
  }
}

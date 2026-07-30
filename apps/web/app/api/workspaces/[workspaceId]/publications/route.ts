import { createPublicationSchema } from "@codev/contracts";

import { apiError, getApiUser } from "@/lib/api";
import {
  listWorkspacePublications,
  PublicationError,
  publishWorkspaceBranch,
} from "@/lib/github-publication";
import { requestId } from "@/lib/observability";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  const publications = await listWorkspacePublications(workspaceId, user.id);
  return Response.json({ publications });
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

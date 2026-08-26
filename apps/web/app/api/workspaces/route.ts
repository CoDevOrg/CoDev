import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { createWorkspace, listWorkspacesForUser } from "@/lib/workspaces";
import { QuotaError, quotaResponse } from "@/lib/quotas";
import { workspaceCreateRequestSchema } from "@/lib/workspace-creation";

export async function GET(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  const workspaces = await listWorkspacesForUser(user.id);
  return Response.json({ workspaces });
}

export async function POST(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const input = workspaceCreateRequestSchema.parse(await request.json());
    const workspace = await createWorkspace(
      user.id,
      input.installationId,
      input.repositoryId,
    );
    return Response.json(
      {
        workspace: {
          id: workspace.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof QuotaError) return quotaResponse(error);
    return apiError(error);
  }
}

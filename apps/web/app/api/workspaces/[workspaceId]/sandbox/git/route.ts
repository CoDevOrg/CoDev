import { apiError, getApiUser } from "@/lib/api";
import { getSandboxGitOutput } from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  const operation = new URL(request.url).searchParams.get("operation");
  if (operation !== "status" && operation !== "diff") {
    return apiError(new Error("operation must be status or diff."), 400);
  }

  try {
    const output = await getSandboxGitOutput(workspaceId, operation);
    return Response.json({ output });
  } catch (error) {
    return apiError(error);
  }
}

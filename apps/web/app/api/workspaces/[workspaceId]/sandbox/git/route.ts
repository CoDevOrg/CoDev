import { apiError, getApiUser } from "@/lib/api";
import { getSandboxGitOutput, readSandboxHeadFile } from "@/lib/orchestrator";
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
  if (operation !== "status" && operation !== "diff" && operation !== "show") {
    return apiError(new Error("operation must be status, diff, or show."), 400);
  }

  try {
    if (operation === "show") {
      const path = new URL(request.url).searchParams.get("path")?.trim();
      if (!path || path.length > 4_096 || path.includes("..")) {
        return apiError(new Error("A valid workspace path is required."), 400);
      }
      const contents = await readSandboxHeadFile(workspaceId, path);
      return Response.json({ contents });
    }
    const output = await getSandboxGitOutput(workspaceId, operation);
    return Response.json({ output });
  } catch (error) {
    return apiError(error);
  }
}

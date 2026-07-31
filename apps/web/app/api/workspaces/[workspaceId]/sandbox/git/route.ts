import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { getWorkspaceSnapshot, readSnapshotFile } from "@/lib/hibernation";
import { getSandboxGitOutput, readSandboxHeadFile } from "@/lib/orchestrator";
import { getWorkspaceRuntime } from "@/lib/workspaces";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  const operation = new URL(request.url).searchParams.get("operation");
  if (operation !== "status" && operation !== "diff" && operation !== "show") {
    return apiError(new Error("operation must be status, diff, or show."), 400);
  }

  try {
    const runtime = await getWorkspaceRuntime(workspaceId);
    const snapshot =
      runtime?.status === "hibernated"
        ? await getWorkspaceSnapshot(workspaceId)
        : null;
    if (snapshot) {
      if (operation === "show") {
        const path = new URL(request.url).searchParams.get("path")?.trim();
        if (!path || path.length > 4_096 || path.includes("..")) {
          return apiError(
            new Error("A valid workspace path is required."),
            400,
          );
        }
        const file = readSnapshotFile(snapshot, path);
        if (!file) return apiError(new Error("Workspace file not found."), 404);
        return Response.json({ contents: file.contents });
      }
      const output =
        operation === "status"
          ? `## hibernated\n${snapshot.snapshot.files.map((file) => ` M ${file.path}`).join("\n")}`
          : "";
      return Response.json({ output });
    }
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

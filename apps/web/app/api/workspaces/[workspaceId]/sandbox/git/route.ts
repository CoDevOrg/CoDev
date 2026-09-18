import { apiError } from "@/lib/http/api";
import { withWorkspace } from "@/lib/http/api-route";
import {
  getWorkspaceSnapshot,
  readSnapshotFile,
} from "@/lib/runtime/hibernation";
import {
  getSandboxGitOutput,
  readSandboxHeadFile,
} from "@/lib/runtime/orchestrator";
import { getWorkspaceRuntime } from "@/lib/workspaces/workspaces";

export const GET = withWorkspace("view", async ({ request, workspaceId }) => {
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
});

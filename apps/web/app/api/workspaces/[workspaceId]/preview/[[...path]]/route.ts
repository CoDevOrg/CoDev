import { apiError, getApiUser } from "@/lib/api";
import { getWorkspaceSnapshot, readSnapshotFile } from "@/lib/hibernation";
import { requireWorkspacePermission } from "@/lib/access";
import { parseFileList } from "@/lib/ide";
import {
  PREVIEW_CSP,
  assertPreviewPath,
  contentTypeForPreviewPath,
  ensureHtmlBaseHref,
  extensionOf,
  previewDirectoryPrefix,
  resolvePreviewEntry,
} from "@/lib/preview";
import {
  OrchestratorError,
  listSandboxFiles,
  readSandboxFile,
} from "@/lib/orchestrator";

function previewHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": PREVIEW_CSP,
    "X-Content-Type-Options": "nosniff",
  };
}

async function resolveRequestedPath(
  workspaceId: string,
  segments: string[] | undefined,
  snapshot: Awaited<ReturnType<typeof getWorkspaceSnapshot>>,
) {
  if (!segments || segments.length === 0) {
    const files = snapshot
      ? snapshot.snapshot.files.map((file) => file.path)
      : parseFileList(await listSandboxFiles(workspaceId)).map(
          (file) => file.path,
        );
    const entry = resolvePreviewEntry(files);
    if (!entry) {
      throw new OrchestratorError(
        "No preview entry found. Ask the agent to create an index.html.",
        404,
      );
    }
    return entry;
  }
  return assertPreviewPath(segments.join("/"));
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; path?: string[] }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId, path: segments } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const snapshot = await getWorkspaceSnapshot(workspaceId);
    const path = await resolveRequestedPath(workspaceId, segments, snapshot);
    const file = snapshot
      ? readSnapshotFile(snapshot, path)
      : await readSandboxFile(workspaceId, path);
    if (!file) {
      throw new OrchestratorError("Preview file not found.", 404);
    }
    const contentType = contentTypeForPreviewPath(path);
    const extension = extensionOf(path);

    if (extension === ".html" || extension === ".htm") {
      const directory = previewDirectoryPrefix(path);
      const baseHref = `/api/workspaces/${workspaceId}/preview/${directory}`;
      const html = ensureHtmlBaseHref(file.contents, baseHref);
      return new Response(html, {
        status: 200,
        headers: previewHeaders(contentType),
      });
    }

    return new Response(file.contents, {
      status: 200,
      headers: previewHeaders(contentType),
    });
  } catch (error) {
    if (error instanceof OrchestratorError) {
      return apiError(error, error.status);
    }
    if (error instanceof Error && /not allowed/i.test(error.message)) {
      return apiError(error, 400);
    }
    return apiError(error);
  }
}

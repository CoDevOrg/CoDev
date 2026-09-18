import { withWorkspace } from "@/lib/http/api-route";
import {
  getWorkspaceSnapshot,
  readSnapshotFile,
} from "@/lib/runtime/hibernation";
import { parseFileList } from "@/lib/runtime/ide";
import {
  PREVIEW_CSP,
  assertPreviewPath,
  contentTypeForPreviewPath,
  ensureHtmlBaseHref,
  extensionOf,
  previewDirectoryPrefix,
  resolvePreviewEntry,
} from "@/lib/runtime/preview";
import {
  OrchestratorError,
  listSandboxFiles,
  readSandboxFile,
} from "@/lib/runtime/orchestrator";

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

// OrchestratorError (including the 404 below) carries its own status; a path
// the preview refuses is a plain 400.
export const GET = withWorkspace<{ workspaceId: string; path?: string[] }>(
  "view",
  async ({ workspaceId, params: { path: segments } }) => {
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
  },
);

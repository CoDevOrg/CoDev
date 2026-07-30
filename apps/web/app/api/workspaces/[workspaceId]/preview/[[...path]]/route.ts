import { apiError, getApiUser } from "@/lib/api";
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
import { getWorkspaceForMember } from "@/lib/workspaces";

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
) {
  if (!segments || segments.length === 0) {
    const listing = await listSandboxFiles(workspaceId);
    const files = parseFileList(listing).map((file) => file.path);
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
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  try {
    const path = await resolveRequestedPath(workspaceId, segments);
    const file = await readSandboxFile(workspaceId, path);
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
    if (
      error instanceof Error &&
      /not allowed/i.test(error.message)
    ) {
      return apiError(error, 400);
    }
    return apiError(error);
  }
}

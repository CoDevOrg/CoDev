import {
  gen2SupersetExternalFileChangesResponseSchema,
  gen2SupersetListFilesResponseSchema,
  gen2SupersetReadFileResponseSchema,
  gen2SupersetSaveFileResponseSchema,
  type Gen2SupersetFile,
  type Gen2SupersetFileEntry,
  type Gen2SupersetExternalFileChange,
} from "@codev/contracts";

export const SUPERSET_WORKTREE_ID = "main";

export class SupersetFileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly currentRevision?: string,
  ) {
    super(message);
    this.name = "SupersetFileApiError";
  }
}

function fileApiBase(workspaceId: string) {
  return `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset`;
}

async function request<T>(
  url: string,
  parse: (payload: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload as {
      error?: unknown;
      currentRevision?: unknown;
    } | null;
    throw new SupersetFileApiError(
      typeof body?.error === "string" ? body.error : "The file request failed.",
      response.status,
      typeof body?.currentRevision === "string"
        ? body.currentRevision
        : undefined,
    );
  }
  return parse(payload);
}

export async function listSupersetFiles(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetFileEntry[]> {
  const response = await request<{ files: Gen2SupersetFileEntry[] }>(
    `${fileApiBase(workspaceId)}/files?worktreeId=${SUPERSET_WORKTREE_ID}`,
    (payload) => gen2SupersetListFilesResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.files;
}

export async function readSupersetFile(
  workspaceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetFile> {
  const query = new URLSearchParams({
    worktreeId: SUPERSET_WORKTREE_ID,
    path,
  });
  const response = await request<{ file: Gen2SupersetFile }>(
    `${fileApiBase(workspaceId)}/file?${query}`,
    (payload) => gen2SupersetReadFileResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.file;
}

export async function saveSupersetFile(
  workspaceId: string,
  file: Gen2SupersetFile,
  contents: string,
): Promise<Gen2SupersetFile> {
  const response = await request<{ file: Gen2SupersetFile }>(
    `${fileApiBase(workspaceId)}/file`,
    (payload) => gen2SupersetSaveFileResponseSchema.parse(payload),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktreeId: SUPERSET_WORKTREE_ID,
        path: file.path,
        contents,
        expectedRevision: file.revision,
      }),
    },
  );
  return response.file;
}

export async function listSupersetFileChanges(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetExternalFileChange[]> {
  const response = await request<{ changes: Gen2SupersetExternalFileChange[] }>(
    `${fileApiBase(workspaceId)}/file/changes?worktreeId=${SUPERSET_WORKTREE_ID}`,
    (payload) => gen2SupersetExternalFileChangesResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.changes;
}

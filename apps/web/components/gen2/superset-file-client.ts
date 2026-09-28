import {
  gen2SupersetCreateEntryResponseSchema,
  gen2SupersetDeleteEntryResponseSchema,
  gen2SupersetExternalFileChangesResponseSchema,
  gen2SupersetListFilesResponseSchema,
  gen2SupersetMoveEntryResponseSchema,
  gen2SupersetReadFileResponseSchema,
  gen2SupersetSaveFileResponseSchema,
  gen2SupersetWorktreeCreateResponseSchema,
  gen2SupersetWorktreeListResponseSchema,
  type Gen2SupersetFile,
  type Gen2SupersetEntry,
  type Gen2SupersetExternalFileChange,
  type Gen2SupersetWorktree,
} from "@codev/contracts";

export const DEFAULT_SUPERSET_WORKTREE_ID = "main";

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
  worktreeId: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetEntry[]> {
  const response = await request<{ files: Gen2SupersetEntry[] }>(
    `${fileApiBase(workspaceId)}/files?worktreeId=${encodeURIComponent(worktreeId)}`,
    (payload) => gen2SupersetListFilesResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.files;
}

export async function createSupersetEntry(
  workspaceId: string,
  worktreeId: string,
  input: { parentPath: string; name: string; kind: "file" | "directory" },
): Promise<Gen2SupersetEntry> {
  const response = await request<{ entry: Gen2SupersetEntry }>(
    `${fileApiBase(workspaceId)}/entry`,
    (payload) => gen2SupersetCreateEntryResponseSchema.parse(payload),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreeId, ...input }),
    },
  );
  return response.entry;
}

export async function moveSupersetEntry(
  workspaceId: string,
  worktreeId: string,
  input: { path: string; parentPath: string; name: string },
): Promise<Gen2SupersetEntry> {
  const response = await request<{ entry: Gen2SupersetEntry }>(
    `${fileApiBase(workspaceId)}/entry`,
    (payload) => gen2SupersetMoveEntryResponseSchema.parse(payload),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreeId, ...input }),
    },
  );
  return response.entry;
}

export async function deleteSupersetEntry(
  workspaceId: string,
  worktreeId: string,
  path: string,
): Promise<string> {
  const response = await request<{ path: string }>(
    `${fileApiBase(workspaceId)}/entry`,
    (payload) => gen2SupersetDeleteEntryResponseSchema.parse(payload),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreeId, path }),
    },
  );
  return response.path;
}

export async function readSupersetFile(
  workspaceId: string,
  worktreeId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetFile> {
  const query = new URLSearchParams({
    worktreeId,
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
  worktreeId: string,
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
        worktreeId,
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
  worktreeId: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetExternalFileChange[]> {
  const response = await request<{ changes: Gen2SupersetExternalFileChange[] }>(
    `${fileApiBase(workspaceId)}/file/changes?worktreeId=${encodeURIComponent(worktreeId)}`,
    (payload) => gen2SupersetExternalFileChangesResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.changes;
}

export async function listSupersetWorktrees(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Gen2SupersetWorktree[]> {
  const response = await request<{ worktrees: Gen2SupersetWorktree[] }>(
    `${fileApiBase(workspaceId)}/worktrees`,
    (payload) => gen2SupersetWorktreeListResponseSchema.parse(payload),
    { signal: signal ?? null },
  );
  return response.worktrees;
}

export async function createSupersetWorktree(
  workspaceId: string,
  input: { worktreeId: string; branch: string; baseRef?: string },
): Promise<Gen2SupersetWorktree> {
  const response = await request<{ worktree: Gen2SupersetWorktree }>(
    `${fileApiBase(workspaceId)}/worktrees`,
    (payload) => gen2SupersetWorktreeCreateResponseSchema.parse(payload),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return response.worktree;
}

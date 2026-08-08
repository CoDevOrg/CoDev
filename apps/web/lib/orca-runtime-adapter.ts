import { z } from "zod";

import type { SearchMatch, WorkspaceFile } from "@/lib/ide";

const errorSchema = z.object({ error: z.string().optional() });
const fileSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
  revision: z.string().min(1),
});
const workspaceFileSchema = z.object({
  path: z.string().min(1),
  status: z.string().optional(),
});
const searchMatchSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  preview: z.string(),
});

export type OrcaRuntimeFile = z.infer<typeof fileSchema>;

/**
 * Browser-hosted implementation of Orca's preload/runtime boundary.
 *
 * Upstream Orca calls methods such as files.list, files.read, files.write and
 * worktree.checkout through window.api. CoDev maps that vocabulary onto its
 * authenticated route handlers, which in turn call codev-guestd over vsock.
 */
export function createOrcaRuntimeAdapter(workspaceId: string) {
  const sandbox = `/api/workspaces/${workspaceId}/sandbox`;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(path, { cache: "no-store", ...init });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = errorSchema.safeParse(body);
      throw new Error(
        parsedError.success && parsedError.data.error
          ? parsedError.data.error
          : `Orca runtime request failed with HTTP ${response.status}.`,
      );
    }
    return schema.parse(body);
  }

  return {
    files: {
      async list(): Promise<WorkspaceFile[]> {
        const result = await request(
          `${sandbox}/files`,
          z.object({ files: z.array(workspaceFileSchema) }),
        );
        return result.files.map((file) =>
          file.status === undefined
            ? { path: file.path }
            : { path: file.path, status: file.status },
        );
      },
      async search(query: string): Promise<SearchMatch[]> {
        const result = await request(
          `${sandbox}/files?query=${encodeURIComponent(query)}`,
          z.object({ matches: z.array(searchMatchSchema) }),
        );
        return result.matches;
      },
      async read(path: string): Promise<OrcaRuntimeFile> {
        const result = await request(
          `${sandbox}/files`,
          z.object({ file: fileSchema }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          },
        );
        return result.file;
      },
      async write(input: {
        path: string;
        contents: string;
        expectedRevision: string;
      }): Promise<string> {
        const result = await request(
          `${sandbox}/files`,
          z.object({ revision: z.string().min(1) }),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        return result.revision;
      },
    },
    git: {
      async show(path: string): Promise<string> {
        const result = await request(
          `${sandbox}/git?operation=show&path=${encodeURIComponent(path)}`,
          z.object({ contents: z.string() }),
        );
        return result.contents;
      },
      async branches(): Promise<{ branches: string[]; currentBranch: string }> {
        return request(
          `${sandbox}/branches`,
          z.object({
            branches: z.array(z.string()),
            currentBranch: z.string(),
          }),
        );
      },
      async checkout(branch: string): Promise<void> {
        await request(
          `${sandbox}/checkout`,
          z.record(z.string(), z.unknown()),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ branch }),
          },
        );
      },
    },
    terminal: {
      streamUrl: `${sandbox}/terminal/stream`,
    },
  };
}

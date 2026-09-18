import "server-only";

import { z } from "zod";

import { orchestratorRequest } from "./orchestrator-request";

const publicationExportSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(4_096),
        mode: z.enum(["100644", "100755", "120000"]),
        contentBase64: z.string(),
      }),
    )
    .max(500),
  totalBytes: z
    .number()
    .int()
    .nonnegative()
    .max(5 * 1_024 * 1_024),
});

export async function snapshotWorkspace(
  workspaceId: string,
  expectedHeadSha: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/snapshot`,
    { expectedHeadSha },
  );
  return publicationExportSchema.parse(await response.json());
}

export async function exportSandboxPublication(
  workspaceId: string,
  expectedHeadSha: string,
  worktreeId?: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/publication/export`,
    {
      expectedHeadSha,
      ...(worktreeId ? { worktreeId } : {}),
    },
  );
  return publicationExportSchema.parse(await response.json());
}

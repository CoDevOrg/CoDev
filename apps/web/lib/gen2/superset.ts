import "server-only";

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
  type Gen2SupersetExternalFileChange,
  type Gen2SupersetEntry,
  type Gen2SupersetWorktree,
} from "@codev/contracts";
import { z } from "zod";

import {
  OrchestratorError,
  orchestratorRequest,
} from "../runtime/orchestrator-request";
import {
  createSupersetWorktree,
  listSupersetWorktrees,
} from "../runtime/orchestrator-superset-runtime";
import { canRunGen2Agent } from "./agent-policy";
import {
  Gen2AccessError,
  Gen2FileConflictError,
  Gen2LifecycleError,
} from "./errors";
import { recordGen2DocumentSave } from "./collaboration-documents";
import { isGen2SupersetRuntimeEnabled } from "./superset-runtime-feature";
import { requireGen2Member } from "./workspaces";

const healthSchema = z.object({ status: z.literal("ok") });

function requireSupersetRuntime() {
  if (!isGen2SupersetRuntimeEnabled()) {
    throw new Gen2LifecycleError("The Superset runtime is not enabled.", 503);
  }
}

/** Keep the Superset service private to the guest; expose only readiness. */
export async function getGen2SupersetHealth(
  workspaceId: string,
  userId: string,
) {
  const workspace = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(workspace.status)) {
    throw new Gen2LifecycleError(
      workspace.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/superset/health`,
    undefined,
    10_000,
  );
  return healthSchema.parse(await response.json());
}

async function requireReadySupersetMember(workspaceId: string, userId: string) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(membership.status)) {
    throw new Gen2LifecycleError(
      membership.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  return membership;
}

export async function listGen2SupersetFiles(
  workspaceId: string,
  userId: string,
  worktreeId: string,
): Promise<Gen2SupersetEntry[]> {
  await requireReadySupersetMember(workspaceId, userId);
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/files`,
    { worktreeId },
    35_000,
  );
  return gen2SupersetListFilesResponseSchema.parse(await response.json()).files;
}

export async function createGen2SupersetEntry(
  workspaceId: string,
  userId: string,
  input: {
    worktreeId: string;
    parentPath: string;
    name: string;
    kind: "file" | "directory";
  },
): Promise<Gen2SupersetEntry> {
  const membership = await requireReadySupersetMember(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to create files and folders.",
      403,
    );
  }
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/entry/create`,
    input,
    35_000,
  );
  return gen2SupersetCreateEntryResponseSchema.parse(await response.json())
    .entry;
}

export async function moveGen2SupersetEntry(
  workspaceId: string,
  userId: string,
  input: {
    worktreeId: string;
    path: string;
    parentPath: string;
    name: string;
  },
): Promise<Gen2SupersetEntry> {
  const membership = await requireReadySupersetMember(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to rename or move files and folders.",
      403,
    );
  }
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/entry/move`,
    input,
    35_000,
  );
  return gen2SupersetMoveEntryResponseSchema.parse(await response.json()).entry;
}

export async function deleteGen2SupersetEntry(
  workspaceId: string,
  userId: string,
  input: { worktreeId: string; path: string },
): Promise<string> {
  const membership = await requireReadySupersetMember(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to delete files and folders.",
      403,
    );
  }
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/entry/delete`,
    input,
    35_000,
  );
  return gen2SupersetDeleteEntryResponseSchema.parse(await response.json())
    .path;
}

export async function readGen2SupersetFile(
  workspaceId: string,
  userId: string,
  worktreeId: string,
  path: string,
): Promise<Gen2SupersetFile> {
  await requireReadySupersetMember(workspaceId, userId);
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/file/read`,
    { worktreeId, path },
    35_000,
  );
  return gen2SupersetReadFileResponseSchema.parse(await response.json()).file;
}

export async function saveGen2SupersetFile(
  workspaceId: string,
  userId: string,
  input: {
    worktreeId: string;
    path: string;
    contents: string;
    expectedRevision: string;
  },
): Promise<Gen2SupersetFile> {
  const membership = await requireReadySupersetMember(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to save files.",
      403,
    );
  }
  try {
    const response = await orchestratorRequest(
      "POST",
      `/v1/sandboxes/${workspaceId}/superset/file/write`,
      input,
      35_000,
    );
    const file = gen2SupersetSaveFileResponseSchema.parse(
      await response.json(),
    ).file;
    // A snapshot is recoverability metadata, never a reason to report a
    // successful revision-checked filesystem save as failed.
    await recordGen2DocumentSave({
      workspaceId,
      path: file.path,
      contents: file.contents,
      revision: file.revision,
    }).catch(() => undefined);
    return file;
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 409) {
      throw new Gen2FileConflictError(
        input.path,
        error.currentRevision ?? "unknown",
      );
    }
    throw error;
  }
}

/**
 * Drains external host-side changes observed since the editor's last poll.
 * The Gen 2 collaboration client reconciles each event with its live buffer;
 * it never receives a host path or host-service credential.
 */
export async function listGen2SupersetExternalFileChanges(
  workspaceId: string,
  userId: string,
  worktreeId: string,
): Promise<Gen2SupersetExternalFileChange[]> {
  await requireReadySupersetMember(workspaceId, userId);
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/file/changes`,
    { worktreeId },
    35_000,
  );
  return gen2SupersetExternalFileChangesResponseSchema.parse(
    await response.json(),
  ).changes;
}

export async function listGen2SupersetWorktrees(
  workspaceId: string,
  userId: string,
): Promise<Gen2SupersetWorktree[]> {
  requireSupersetRuntime();
  await requireReadySupersetMember(workspaceId, userId);
  return gen2SupersetWorktreeListResponseSchema.parse({
    worktrees: await listSupersetWorktrees(workspaceId),
  }).worktrees;
}

export async function createGen2SupersetWorktree(
  workspaceId: string,
  userId: string,
  input: { worktreeId: string; branch: string; baseRef?: string | undefined },
): Promise<Gen2SupersetWorktree> {
  requireSupersetRuntime();
  const membership = await requireReadySupersetMember(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to create a worktree.",
      403,
    );
  }
  return gen2SupersetWorktreeCreateResponseSchema.parse({
    worktree: await createSupersetWorktree(workspaceId, input),
  }).worktree;
}

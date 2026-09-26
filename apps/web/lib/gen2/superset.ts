import "server-only";

import {
  gen2SupersetListFilesResponseSchema,
  gen2SupersetReadFileResponseSchema,
  gen2SupersetSaveFileResponseSchema,
  type Gen2SupersetFile,
  type Gen2SupersetFileEntry,
} from "@codev/contracts";
import { z } from "zod";

import {
  OrchestratorError,
  orchestratorRequest,
} from "../runtime/orchestrator-request";
import { canRunGen2Agent } from "./agent-policy";
import {
  Gen2AccessError,
  Gen2FileConflictError,
  Gen2LifecycleError,
} from "./errors";
import { requireGen2Member } from "./workspaces";

const healthSchema = z.object({ status: z.literal("ok") });

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
): Promise<Gen2SupersetFileEntry[]> {
  await requireReadySupersetMember(workspaceId, userId);
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/files`,
    { worktreeId },
    35_000,
  );
  return gen2SupersetListFilesResponseSchema.parse(await response.json()).files;
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
    return gen2SupersetSaveFileResponseSchema.parse(await response.json()).file;
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

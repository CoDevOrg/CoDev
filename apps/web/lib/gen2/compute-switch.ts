import "server-only";
import type { Gen2ComputeSwitchResponse } from "@codev/contracts";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import { requireGen2Member } from "./workspaces";
import { workspaceOwnerId } from "./compute-quota";
import { stopGen2Instance, ensureGen2Instance } from "./instance";
import { queueAzureWorkspaceStop } from "./runtime-operations";
import { Gen2LifecycleError } from "./errors";

/** An owner explicitly confirms the workspace to stop; guests are never evicted on open. */
export async function requestFreeComputeSwitch(
  workspaceId: string,
  activeWorkspaceId: string,
  userId: string,
  idempotencyKey: string,
): Promise<Gen2ComputeSwitchResponse> {
  if (workspaceId === activeWorkspaceId)
    throw new Gen2LifecycleError("Choose a different workspace.", 400);
  const active = await validateSwitchOwner(
    workspaceId,
    activeWorkspaceId,
    userId,
  );
  if (active.runtimeStatus === "stopped" || active.status === "pending") {
    await stopGen2Instance(activeWorkspaceId, userId);
    const started = await ensureGen2Instance(
      workspaceId,
      userId,
      undefined,
      idempotencyKey,
    );
    return {
      accepted: true,
      workspaceId,
      operationId:
        "operationId" in started && typeof started.operationId === "string"
          ? started.operationId
          : null,
      stoppingWorkspaceId: null,
    };
  }
  if (active.status === "provisioning" && active.runtimeStatus !== "stopping")
    throw new Gen2LifecycleError(
      "Wait for the current startup to finish before switching workspaces.",
      409,
    );
  const operation = await queueAzureWorkspaceStop(
    activeWorkspaceId,
    idempotencyKey,
    userId,
  );
  return {
    accepted: true,
    workspaceId,
    stoppingWorkspaceId: activeWorkspaceId,
    operationId: operation?.operationId ?? null,
  };
}

async function validateSwitchOwner(
  workspaceId: string,
  activeWorkspaceId: string,
  userId: string,
) {
  const [target, active] = await Promise.all([
    requireGen2Member(workspaceId, userId),
    requireGen2Member(activeWorkspaceId, userId),
  ]);
  const ownerId = await workspaceOwnerId(workspaceId);
  if (ownerId !== userId || active.role !== "owner" || target.role !== "owner")
    throw new Gen2LifecycleError(
      "Only the owner can switch active workspaces.",
      403,
    );
  const policy = await getWorkspaceOwnerEntitlement(ownerId);
  if (
    policy.tier !== "free" ||
    !policy.enabled ||
    target.runtimeProvider !== "azure_arm" ||
    active.runtimeProvider !== "azure_arm"
  )
    throw new Gen2LifecycleError(
      "This workspace does not use the free ARM plan.",
      400,
    );
  return active;
}

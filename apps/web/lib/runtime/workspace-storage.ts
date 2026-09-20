import "server-only";

import { ComputeManagementClient } from "@azure/arm-compute";
import { readServerEnvironment } from "@codev/config";
import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  getAzureCredential,
  getAzureResourceGroup,
  getAzureSubscriptionId,
} from "./azure";
import { getDatabase } from "../platform/database";
import type { RuntimeHostLease } from "./runtime-host-pool";

const WORKSPACE_DISK_TAG = "CoDevWorkspaceStorage";
const RESERVED_LUNS = new Set([0]);
const MAX_DATA_DISK_LUN = 63;

let client: ComputeManagementClient | undefined;

function getClient() {
  return (client ??= new ComputeManagementClient(
    getAzureCredential(),
    getAzureSubscriptionId(),
  ));
}

function diskNameForWorkspace(workspaceId: string) {
  return `codev-ws-${workspaceId.replaceAll("-", "")}`;
}

function diskSizeGiB() {
  return readServerEnvironment().CODEV_WORKSPACE_DISK_SIZE_GIB ?? 64;
}

/**
 * Persistent storage is deliberately gated behind the host pool. Without a
 * fenced host assignment there is no safe owner for a writable disk.
 */
export function isWorkspacePersistentStorageEnabled() {
  const environment = readServerEnvironment();
  return (
    environment.CODEV_RUNTIME_HOST_POOL_ENABLED === "true" &&
    environment.CODEV_WORKSPACE_PERSISTENT_STORAGE_ENABLED === "true"
  );
}

export function selectWorkspaceDiskLun(usedLuns: Iterable<number>) {
  const used = new Set(usedLuns);
  for (let lun = 1; lun <= MAX_DATA_DISK_LUN; lun += 1) {
    if (!RESERVED_LUNS.has(lun) && !used.has(lun)) return lun;
  }
  throw new Error("The runtime host has no free data-disk LUNs.");
}

function diskNameFromResourceId(resourceId: string) {
  const match = /\/disks\/([^/]+)$/i.exec(resourceId);
  if (!match?.[1])
    throw new Error("The workspace disk resource ID is invalid.");
  return match[1];
}

async function withAzureRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const candidate = error as { statusCode?: unknown; code?: unknown };
      const retryable =
        candidate.statusCode === 429 ||
        candidate.code === "TooManyRequests" ||
        candidate.code === "Conflict" ||
        (typeof candidate.statusCode === "number" &&
          candidate.statusCode >= 500);
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error("unreachable");
}

async function ensureManagedDisk(workspaceId: string, diskId: string | null) {
  const resourceGroup = getAzureResourceGroup();
  const name = diskId
    ? diskNameFromResourceId(diskId)
    : diskNameForWorkspace(workspaceId);
  try {
    const existing = await withAzureRetry(() =>
      getClient().disks.get(resourceGroup, name),
    );
    if (existing.tags?.WorkspaceId !== workspaceId) {
      throw new Error("The workspace disk is not owned by this workspace.");
    }
    return existing;
  } catch (error) {
    const candidate = error as { statusCode?: unknown; code?: unknown };
    if (candidate.statusCode !== 404 && candidate.code !== "ResourceNotFound") {
      throw error;
    }
  }

  const location = readServerEnvironment().AZURE_RUNTIME_LOCATION;
  if (!location) {
    throw new Error(
      "AZURE_RUNTIME_LOCATION is required when persistent workspace storage is enabled.",
    );
  }
  return withAzureRetry(() =>
    getClient().disks.beginCreateOrUpdateAndWait(resourceGroup, name, {
      location,
      sku: { name: "Premium_LRS" },
      diskSizeGB: diskSizeGiB(),
      creationData: { createOption: "Empty" },
      networkAccessPolicy: "DenyAll",
      publicNetworkAccess: "Disabled",
      optimizedForFrequentAttach: true,
      tags: {
        Project: "CoDev",
        ManagedBy: WORKSPACE_DISK_TAG,
        WorkspaceId: workspaceId,
      },
    }),
  );
}

async function attachManagedDisk(
  hostName: string,
  diskId: string,
  requestedLun: number | null,
) {
  const resourceGroup = getAzureResourceGroup();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const vm = await withAzureRetry(() =>
      getClient().virtualMachines.get(resourceGroup, hostName),
    );
    const dataDisks = vm.storageProfile?.dataDisks ?? [];
    const attached = dataDisks.find((disk) => disk.managedDisk?.id === diskId);
    if (attached?.lun !== undefined) return attached.lun;

    const usedLuns = dataDisks
      .map((disk) => disk.lun)
      .filter((lun): lun is number => lun !== undefined);
    const lun =
      requestedLun !== null && !usedLuns.includes(requestedLun)
        ? requestedLun
        : selectWorkspaceDiskLun(usedLuns);

    try {
      await withAzureRetry(() =>
        getClient().virtualMachines.beginAttachDetachDataDisksAndWait(
          resourceGroup,
          hostName,
          {
            dataDisksToAttach: [
              {
                diskId,
                lun,
                caching: "None",
                deleteOption: "Detach",
              },
            ],
          },
        ),
      );
      return lun;
    } catch (error) {
      const candidate = error as { statusCode?: unknown; code?: unknown };
      const conflict =
        candidate.statusCode === 409 || candidate.code === "Conflict";
      if (!conflict || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error("workspace disk attach did not converge");
}

/** Ensure a workspace has one exclusive, durable managed disk on its fenced host. */
export async function ensureWorkspaceRuntimeStorage(
  workspaceId: string,
  lease: RuntimeHostLease,
): Promise<RuntimeHostLease> {
  if (!isWorkspacePersistentStorageEnabled()) return lease;

  const disk = await ensureManagedDisk(workspaceId, lease.diskId);
  const diskId = disk.id;
  if (!diskId)
    throw new Error("Azure returned a workspace disk without an ID.");
  let diskLun: number;
  try {
    diskLun = await attachManagedDisk(lease.providerId, diskId, lease.diskLun);
  } catch (error) {
    await detachWorkspaceRuntimeStorage(lease.providerId, diskId).catch(
      () => undefined,
    );
    throw error;
  }

  try {
    await getDatabase()
      .update(schema.workspaceRuntimeAssignments)
      .set({ diskId, diskLun, updatedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceRuntimeAssignments.workspaceId, workspaceId),
          eq(schema.workspaceRuntimeAssignments.hostId, lease.hostId),
          eq(schema.workspaceRuntimeAssignments.generation, lease.generation),
          eq(
            schema.workspaceRuntimeAssignments.fencingToken,
            lease.fencingToken,
          ),
        ),
      );
  } catch (error) {
    await detachWorkspaceRuntimeStorage(lease.providerId, diskId).catch(
      () => undefined,
    );
    throw error;
  }

  return { ...lease, diskId, diskLun };
}

/** Detach a workspace disk only after the runtime has stopped and flushed it. */
export async function detachWorkspaceRuntimeStorage(
  hostName: string,
  diskId: string | null,
) {
  if (!isWorkspacePersistentStorageEnabled() || !diskId) return;
  const resourceGroup = getAzureResourceGroup();
  try {
    const vm = await withAzureRetry(() =>
      getClient().virtualMachines.get(resourceGroup, hostName),
    );
    const attached = vm.storageProfile?.dataDisks?.some(
      (disk) => disk.managedDisk?.id === diskId,
    );
    if (!attached) return;
    await withAzureRetry(() =>
      getClient().virtualMachines.beginAttachDetachDataDisksAndWait(
        resourceGroup,
        hostName,
        { dataDisksToDetach: [{ diskId, detachOption: "ForceDetach" }] },
      ),
    );
  } catch (error) {
    const candidate = error as { statusCode?: unknown; code?: unknown };
    if (candidate.statusCode === 404 || candidate.code === "ResourceNotFound")
      return;
    throw error;
  }
}

import "server-only";
import { enforceArmComputeEntitlement } from "./arm-compute-policy";
import { releaseFreeWorkspaceCompute } from "./free-compute-release";
import { lockComputeOwners } from "./compute-database";

import type { WorkflowStep } from "cloudflare:workers";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { createDatabase, schema } from "@codev/db";
import type {
  Gen2RuntimeOperationKind,
  Gen2RuntimeStatus,
  Gen2WorkspaceStatus,
} from "@codev/contracts";

import { Gen2LifecycleError } from "./errors";
import { initializeGen2ArmWorkspace } from "./arm-workspace-initialize";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import {
  ArmWorkspaceProvider,
  ArmWorkspaceRuntimeError,
  type ArmWorkspaceProgress,
} from "../runtime/arm-workspace-provider";

export type { ArmWorkspaceWorkflowParams } from "@codev/contracts";
import type { ArmWorkspaceWorkflowParams } from "@codev/contracts";
import {
  armWorkflowBinding,
  type WorkflowBinding,
} from "./arm-workflow-binding";

type WorkflowEnvironment = {
  HYPERDRIVE?: { connectionString?: string };
  GEN2_ARM_WORKSPACE_LIFECYCLE?: WorkflowBinding;
};

type RuntimeRow = {
  id: string;
  ownerId: string;
  status: Gen2WorkspaceStatus;
  runtimeProvider: string;
  runtimeStatus: Gen2RuntimeStatus;
  runtimeGeneration: number;
  runtimeVmResourceId: string | null;
  runtimeDiskResourceId: string | null;
  runtimeDiskUuid: string | null;
  runtimeTunnelId: string | null;
  runtimeRouteHost: string | null;
  runtimeCleanupGeneration: number | null;
  runtimeOperationId: string | null;
  runtimeOperationKey: string | null;
  runtimeOperationKind: Gen2RuntimeOperationKind | null;
  runtimeOperationStartedAt: Date | null;
  runtimeLeaseExpiresAt: Date | null;
};

const ACTIVE_STATES: Gen2RuntimeStatus[] = [
  "queued",
  "provisioning",
  "booting",
  "attaching_disk",
  "starting_tunnel",
  "checking_readiness",
  "stopping",
];
const OPERATION_LEASE_MS = 20 * 60_000;
const OPERATION_RETRY_DELAY_MS = 5 * 60_000;

function errorMessage(code: string) {
  switch (code) {
    case "SKU_UNAVAILABLE":
    case "AllocationFailed":
    case "ZonalAllocationFailed":
      return "Azure could not allocate this ARM workspace right now. Try again shortly.";
    case "QuotaExceeded":
    case "QUOTA_EXCEEDED":
      return "The Azure subscription has reached its workspace capacity limit.";
    case "DISK_MISSING":
    case "ResourceNotFound":
      return "The saved workspace disk could not be found. No replacement disk was created.";
    case "DISK_IDENTITY_MISMATCH":
    case "DISK_ATTACH_CONFLICT":
      return "The saved workspace disk could not be safely attached. Your data was left untouched.";
    case "CLOUDFLARE_DNS_CONFLICT":
      return "The secure workspace route conflicts with an existing DNS record.";
    case "RUNTIME_CONFIGURATION_MISSING":
    case "RUNTIME_CONFIGURATION_INVALID":
      return "ARM workspace runtime configuration is incomplete.";
    case "GUEST_RUNTIME_UPDATE_REQUIRED":
      return "The ARM workspace image needs an update before this workspace can start.";
    case "WORKSPACE_INITIALIZATION_FAILED":
      return "The workspace repository could not be initialized. Saved workspace data was left untouched.";
    case "AZURE_AUTHENTICATION_FAILED":
      return "The ARM workspace service could not authenticate with Azure.";
    case "CLOUDFLARE_TUNNEL_FAILED":
      return "The secure connection to this workspace could not be created.";
    case "GUEST_READINESS_TIMEOUT":
      return "The workspace VM started but its secure guest connection did not become ready.";
    case "VM_BOOT_TIMEOUT":
    case "VM_FAILED_TO_START":
      return "The ARM workspace VM did not finish booting. Try again.";
    default:
      return "The ARM workspace could not start. Try again, or contact support if it keeps failing.";
  }
}

function operationError(error: unknown) {
  if (error instanceof ArmWorkspaceRuntimeError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,}$/.test(error.message))
    return error.message;
  return "ARM_WORKSPACE_OPERATION_FAILED";
}

function workflowBinding() {
  return armWorkflowBinding();
}

async function createOrJoinWorkflow(params: ArmWorkspaceWorkflowParams) {
  const binding = workflowBinding();
  try {
    await binding.create({ id: params.operationId, params });
    return;
  } catch {
    try {
      const instance = await binding.get(params.operationId);
      const { status } = await instance.status();
      if (
        ["queued", "running", "paused", "waiting", "waitingForPause"].includes(
          status ?? "",
        )
      )
        return;
    } catch {
      // A create failure with no existing instance is recorded as retryable below.
    }
    throw new Gen2LifecycleError(
      "The ARM workspace startup job could not be queued. Try again.",
      503,
    );
  }
}

async function loadRuntimeRow(workspaceId: string): Promise<RuntimeRow> {
  const [row] = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      ownerId: schema.gen2Workspaces.ownerId,
      status: schema.gen2Workspaces.status,
      runtimeProvider: schema.gen2Workspaces.runtimeProvider,
      runtimeStatus: schema.gen2Workspaces.runtimeStatus,
      runtimeGeneration: schema.gen2Workspaces.runtimeGeneration,
      runtimeVmResourceId: schema.gen2Workspaces.runtimeVmResourceId,
      runtimeDiskResourceId: schema.gen2Workspaces.runtimeDiskResourceId,
      runtimeDiskUuid: schema.gen2Workspaces.runtimeDiskUuid,
      runtimeTunnelId: schema.gen2Workspaces.runtimeTunnelId,
      runtimeRouteHost: schema.gen2Workspaces.runtimeRouteHost,
      runtimeCleanupGeneration: schema.gen2Workspaces.runtimeCleanupGeneration,
      runtimeOperationId: schema.gen2Workspaces.runtimeOperationId,
      runtimeOperationKey: schema.gen2Workspaces.runtimeOperationKey,
      runtimeOperationKind: schema.gen2Workspaces.runtimeOperationKind,
      runtimeOperationStartedAt:
        schema.gen2Workspaces.runtimeOperationStartedAt,
      runtimeLeaseExpiresAt: schema.gen2Workspaces.runtimeLeaseExpiresAt,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new Gen2LifecycleError("Workspace not found.", 404);
  if (row.runtimeProvider !== "azure_arm") {
    throw new Gen2LifecycleError(
      "This workspace uses the Firecracker runtime.",
    );
  }
  return row as RuntimeRow;
}

async function joinExistingOperation(
  row: RuntimeRow,
  kind: Gen2RuntimeOperationKind,
) {
  if (
    row.runtimeOperationKind !== kind ||
    !row.runtimeOperationId ||
    row.runtimeStatus === "failed"
  )
    return null;
  const params: ArmWorkspaceWorkflowParams = {
    workspaceId: row.id,
    operationId: row.runtimeOperationId,
    generation: row.runtimeGeneration,
    resourceGeneration: row.runtimeGeneration,
    cleanupGeneration: row.runtimeCleanupGeneration,
    kind,
  };
  await createOrJoinWorkflow(params);
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({ runtimeLeaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS) })
    .where(
      and(
        eq(schema.gen2Workspaces.id, row.id),
        eq(schema.gen2Workspaces.runtimeGeneration, row.runtimeGeneration),
        eq(schema.gen2Workspaces.runtimeOperationId, params.operationId),
      ),
    );
  return { operationId: params.operationId, generation: params.generation };
}

async function claimOperation(
  row: RuntimeRow,
  kind: Gen2RuntimeOperationKind,
  idempotencyKey: string,
) {
  const now = new Date();
  const operationId = crypto.randomUUID();
  const generation = row.runtimeGeneration + (kind === "start" ? 1 : 0);
  const resourceGeneration =
    kind === "start" ? generation : row.runtimeGeneration;
  const cleanupCurrentGeneration =
    kind === "start" &&
    (row.status === "ready" ||
      Boolean(row.runtimeVmResourceId) ||
      (ACTIVE_STATES.includes(row.runtimeStatus) &&
        row.runtimeLeaseExpiresAt !== null &&
        row.runtimeLeaseExpiresAt <= now) ||
      (row.runtimeStatus === "failed" && row.runtimeOperationKind === "start"));
  const cleanupGeneration =
    kind === "start"
      ? (row.runtimeCleanupGeneration ??
        (cleanupCurrentGeneration ? row.runtimeGeneration : null))
      : row.runtimeCleanupGeneration;
  const acceptedStates: Gen2WorkspaceStatus[] =
    kind === "start"
      ? ["pending", "ready", "stopped", "failed"]
      : kind === "stop"
        ? ["ready", "failed"]
        : ["pending", "ready", "stopped", "failed", "deleting"];
  if (!acceptedStates.includes(row.status)) {
    throw new Gen2LifecycleError(
      "The workspace is changing state. Try again.",
      409,
    );
  }
  const changed = await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      status: kind === "delete" ? "deleting" : "provisioning",
      runtimeStatus: kind === "start" ? "queued" : "stopping",
      runtimeGeneration: generation,
      runtimeOperationId: operationId,
      runtimeOperationKey: idempotencyKey,
      runtimeOperationKind: kind,
      runtimeOperationStartedAt: now,
      runtimeLeaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS),
      runtimeCleanupGeneration:
        kind === "start" ? cleanupGeneration : row.runtimeCleanupGeneration,
      runtimeTunnelId: kind === "start" ? null : row.runtimeTunnelId,
      runtimeRouteHost: kind === "start" ? null : row.runtimeRouteHost,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.gen2Workspaces.id, row.id),
        eq(schema.gen2Workspaces.ownerId, row.ownerId),
        eq(schema.gen2Workspaces.runtimeGeneration, row.runtimeGeneration),
        eq(schema.gen2Workspaces.runtimeStatus, row.runtimeStatus),
        eq(schema.gen2Workspaces.status, row.status as Gen2WorkspaceStatus),
      ),
    )
    .returning({ id: schema.gen2Workspaces.id });
  if (!changed.length) return null;
  return {
    operationId,
    generation,
    resourceGeneration,
    cleanupGeneration,
  };
}

async function markQueueFailure(
  params: ArmWorkspaceWorkflowParams,
  message: string,
) {
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      status: "failed",
      runtimeStatus: "failed",
      lastError: message,
      runtimeOperationStartedAt: new Date(),
      runtimeLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.gen2Workspaces.id, params.workspaceId),
        eq(schema.gen2Workspaces.runtimeOperationId, params.operationId),
        eq(schema.gen2Workspaces.runtimeGeneration, params.generation),
      ),
    );
}

export async function queueAzureWorkspaceStart(
  workspaceId: string,
  idempotencyKey: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadRuntimeRow(workspaceId);
    const joined = await joinExistingOperation(row, "start");
    if (joined) return { accepted: true as const, ...joined };
    if (row.runtimeStatus === "ready") {
      const healthy = await new ArmWorkspaceProvider().healthy(
        row.id,
        row.runtimeGeneration,
        row.runtimeDiskUuid ?? "",
        row.runtimeRouteHost,
      );
      if (healthy) return { accepted: false as const, operationId: null };
    }
    const claimed = await claimOperation(row, "start", idempotencyKey);
    if (!claimed) continue;
    const params = { workspaceId, ...claimed, kind: "start" as const };
    try {
      await createOrJoinWorkflow(params);
    } catch (error) {
      await markQueueFailure(params, errorMessage(operationError(error)));
      throw error;
    }
    return { accepted: true as const, ...claimed };
  }
  throw new Gen2LifecycleError("The workspace changed state. Try again.", 409);
}

export async function queueAzureWorkspaceStop(
  workspaceId: string,
  idempotencyKey: string,
  expectedOwnerId?: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadRuntimeRow(workspaceId);
    if (expectedOwnerId && row.ownerId !== expectedOwnerId)
      throw new Gen2LifecycleError(
        "Only the current owner can stop this workspace.",
        403,
      );
    const joined = await joinExistingOperation(row, "stop");
    if (joined) return joined;
    if (row.status === "stopped") return null;
    const claimed = await claimOperation(row, "stop", idempotencyKey);
    if (!claimed) continue;
    const params = { workspaceId, ...claimed, kind: "stop" as const };
    try {
      await createOrJoinWorkflow(params);
    } catch (error) {
      await markQueueFailure(params, errorMessage(operationError(error)));
      throw error;
    }
    return claimed;
  }
  throw new Gen2LifecycleError("The workspace changed state. Try again.", 409);
}

export async function queueAzureWorkspaceDelete(
  workspaceId: string,
  idempotencyKey: string,
  expectedOwnerId?: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadRuntimeRow(workspaceId);
    if (expectedOwnerId && row.ownerId !== expectedOwnerId)
      throw new Gen2LifecycleError(
        "Only the current owner can delete this workspace.",
        403,
      );
    const joined = await joinExistingOperation(row, "delete");
    if (joined) return joined;
    const claimed = await claimOperation(row, "delete", idempotencyKey);
    if (!claimed) continue;
    const params = { workspaceId, ...claimed, kind: "delete" as const };
    try {
      await createOrJoinWorkflow(params);
    } catch (error) {
      await markQueueFailure(params, errorMessage(operationError(error)));
      throw error;
    }
    return claimed;
  }
  throw new Gen2LifecycleError("The workspace changed state. Try again.", 409);
}

export async function checkAzureWorkspaceConnection(workspaceId: string) {
  const row = await loadRuntimeRow(workspaceId);
  if (row.runtimeStatus !== "ready") return false;
  return new ArmWorkspaceProvider().healthy(
    row.id,
    row.runtimeGeneration,
    row.runtimeDiskUuid ?? "",
    row.runtimeRouteHost,
  );
}

export async function touchAzureWorkspaceActivity(workspaceId: string) {
  const connected = await checkAzureWorkspaceConnection(workspaceId);
  if (!connected) return false;
  await getDatabase()
    .update(schema.gen2ComputeSessions)
    .set({ lastActivityAt: new Date() })
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    );
  return true;
}

function runtimeConnectionString(env: WorkflowEnvironment) {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error("HYPERDRIVE_NOT_CONFIGURED");
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

async function withWorkflowDatabase<T>(
  env: WorkflowEnvironment,
  action: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>,
) {
  const database = createDatabase(runtimeConnectionString(env), {
    max: 1,
    maxUses: 1,
  });
  try {
    return await action(database.db);
  } finally {
    await database.pool.end();
  }
}

async function currentOperation(
  db: WorkflowDatabase | WorkflowTransaction,
  params: ArmWorkspaceWorkflowParams,
) {
  const [row] = await db
    .select({
      id: schema.gen2Workspaces.id,
      ownerId: schema.gen2Workspaces.ownerId,
      status: schema.gen2Workspaces.status,
      runtimeProvider: schema.gen2Workspaces.runtimeProvider,
      runtimeStatus: schema.gen2Workspaces.runtimeStatus,
      runtimeGeneration: schema.gen2Workspaces.runtimeGeneration,
      runtimeVmResourceId: schema.gen2Workspaces.runtimeVmResourceId,
      runtimeDiskResourceId: schema.gen2Workspaces.runtimeDiskResourceId,
      runtimeDiskUuid: schema.gen2Workspaces.runtimeDiskUuid,
      runtimeTunnelId: schema.gen2Workspaces.runtimeTunnelId,
      runtimeRouteHost: schema.gen2Workspaces.runtimeRouteHost,
      runtimeCleanupGeneration: schema.gen2Workspaces.runtimeCleanupGeneration,
      runtimeOperationId: schema.gen2Workspaces.runtimeOperationId,
      runtimeOperationKind: schema.gen2Workspaces.runtimeOperationKind,
    })
    .from(schema.gen2Workspaces)
    .where(
      and(
        eq(schema.gen2Workspaces.id, params.workspaceId),
        eq(schema.gen2Workspaces.runtimeGeneration, params.generation),
        eq(schema.gen2Workspaces.runtimeOperationId, params.operationId),
      ),
    )
    .limit(1);
  if (!row || row.runtimeProvider !== "azure_arm") {
    throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
  }
  return row;
}

function operationWhere(params: ArmWorkspaceWorkflowParams) {
  return and(
    eq(schema.gen2Workspaces.id, params.workspaceId),
    eq(schema.gen2Workspaces.runtimeGeneration, params.generation),
    eq(schema.gen2Workspaces.runtimeOperationId, params.operationId),
  );
}

async function updateProgress(
  db: ReturnType<typeof createDatabase>["db"],
  params: ArmWorkspaceWorkflowParams,
  status: Gen2RuntimeStatus,
  resources: Partial<{
    vmId: string;
    diskId: string;
    diskUuid: string;
    tunnelId: string;
    routeHost: string;
  }>,
) {
  const row = await currentOperation(db, params);
  const updated = await db
    .update(schema.gen2Workspaces)
    .set({
      runtimeStatus: status,
      ...(resources.vmId ? { runtimeVmResourceId: resources.vmId } : {}),
      ...(resources.diskId ? { runtimeDiskResourceId: resources.diskId } : {}),
      ...(resources.diskUuid ? { runtimeDiskUuid: resources.diskUuid } : {}),
      ...(resources.tunnelId ? { runtimeTunnelId: resources.tunnelId } : {}),
      ...(resources.routeHost ? { runtimeRouteHost: resources.routeHost } : {}),
      runtimeLeaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
      updatedAt: new Date(),
    })
    .where(operationWhere(params))
    .returning({ id: schema.gen2Workspaces.id });
  if (!updated.length) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
  if (resources.vmId) {
    const state = await new ArmWorkspaceProvider().powerState(
      row.id,
      params.resourceGeneration,
      resources.vmId,
    );
    if (state && state !== "PowerState/deallocated")
      await startComputeSession(db, row);
  }
  return row;
}

async function startComputeSession(
  db: WorkflowTransaction | WorkflowDatabase,
  row: Awaited<ReturnType<typeof currentOperation>>,
) {
  await db
    .insert(schema.gen2ComputeSessions)
    .values({
      workspaceId: row.id,
      ownerId: row.ownerId,
      startedAt: new Date(),
      lastObservedAllocatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function endComputeSession(
  db: WorkflowTransaction | WorkflowDatabase,
  workspaceId: string,
) {
  await db
    .update(schema.gen2ComputeSessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    );
}

type WorkflowDatabase = ReturnType<typeof createDatabase>["db"];
type WorkflowTransaction = Parameters<
  Parameters<WorkflowDatabase["transaction"]>[0]
>[0];

async function stopResourceGenerations(
  provider: ArmWorkspaceProvider,
  workspaceId: string,
  diskId: string | null,
  diskUuid: string | null,
  generations: Array<number | null>,
) {
  let failure: unknown;
  for (const generation of [
    ...new Set(generations.filter((value) => value !== null)),
  ]) {
    try {
      await provider.stop({ workspaceId, generation, diskId, diskUuid });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

async function executeOperation(
  env: WorkflowEnvironment,
  params: ArmWorkspaceWorkflowParams,
) {
  return withWorkflowDatabase(env, async (db) => {
    const provider = new ArmWorkspaceProvider();
    const row = await currentOperation(db, params);
    if (params.kind === "start") {
      await enforceArmComputeEntitlement(db, row.id, row.ownerId);
      if (params.cleanupGeneration !== null) {
        await provider.stop({
          workspaceId: row.id,
          generation: params.cleanupGeneration,
          diskId: row.runtimeDiskResourceId,
          diskUuid: row.runtimeDiskUuid,
        });
        const [cleaned] = await db
          .update(schema.gen2Workspaces)
          .set({ runtimeCleanupGeneration: null, updatedAt: new Date() })
          .where(operationWhere(params))
          .returning({ id: schema.gen2Workspaces.id });
        if (!cleaned) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
        await endComputeSession(db, row.id);
      }
      const progress: ArmWorkspaceProgress = (status, resources) =>
        updateProgress(db, params, status, resources).then(() => undefined);
      const ready = await provider.start(
        {
          workspaceId: row.id,
          generation: params.resourceGeneration,
          diskId: row.runtimeDiskResourceId,
          diskUuid: row.runtimeDiskUuid,
        },
        progress,
      );
      const currentOwner = await currentOperation(db, params);
      await enforceArmComputeEntitlement(db, row.id, currentOwner.ownerId);
      await initializeGen2ArmWorkspace(db, {
        workspaceId: row.id,
        generation: params.resourceGeneration,
        host: ready.routeHost,
      });
      await currentOperation(db, params);
      const result = await db.transaction(async (transaction) => {
        const current = await currentOperation(transaction, params);
        await lockComputeOwners(transaction, [current.ownerId]);
        const checked = await currentOperation(transaction, params);
        if (checked.ownerId !== current.ownerId)
          throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
        await enforceArmComputeEntitlement(
          transaction,
          checked.id,
          checked.ownerId,
        );
        const [completed] = await transaction
          .update(schema.gen2Workspaces)
          .set({
            status: "ready",
            runtimeStatus: "ready",
            runtimeVmResourceId: ready.vmId,
            runtimeDiskResourceId: ready.diskId,
            runtimeDiskUuid: ready.diskUuid,
            runtimeTunnelId: ready.tunnelId,
            runtimeRouteHost: ready.routeHost,
            runtimeOperationId: null,
            runtimeOperationKey: null,
            runtimeOperationKind: null,
            runtimeOperationStartedAt: null,
            runtimeLeaseExpiresAt: null,
            runtimeCleanupGeneration: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(operationWhere(params))
          .returning({ id: schema.gen2Workspaces.id });
        if (!completed) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
        await startComputeSession(transaction, checked);
        return completed;
      });
      logEvent("info", "gen2.azure_runtime.ready", {
        workspaceId: row.id,
        operationId: params.operationId,
        generation: params.generation,
      });
      return result;
    }

    if (params.kind === "stop") {
      await stopResourceGenerations(
        provider,
        row.id,
        row.runtimeDiskResourceId,
        row.runtimeDiskUuid,
        [params.cleanupGeneration, params.resourceGeneration],
      );
      await db.transaction(async (transaction) => {
        const [completed] = await transaction
          .update(schema.gen2Workspaces)
          .set({
            status: "stopped",
            runtimeStatus: "stopped",
            runtimeVmResourceId: null,
            runtimeTunnelId: null,
            runtimeRouteHost: null,
            runtimeOperationId: null,
            runtimeOperationKey: null,
            runtimeOperationKind: null,
            runtimeOperationStartedAt: null,
            runtimeLeaseExpiresAt: null,
            runtimeCleanupGeneration: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(operationWhere(params))
          .returning({ id: schema.gen2Workspaces.id });
        if (!completed) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
        await endComputeSession(transaction, row.id);
        await releaseFreeWorkspaceCompute(transaction, row.id);
      });
      return { status: "stopped" as const };
    }

    await stopResourceGenerations(
      provider,
      row.id,
      row.runtimeDiskResourceId,
      row.runtimeDiskUuid,
      [params.cleanupGeneration, params.resourceGeneration],
    );
    await provider.deleteDisk(row.runtimeDiskResourceId, row.id);
    await db.transaction(async (transaction) => {
      await lockComputeOwners(transaction, [row.ownerId]);
      await endComputeSession(transaction, row.id);
      const deleted = await transaction
        .delete(schema.gen2Workspaces)
        .where(operationWhere(params))
        .returning({ id: schema.gen2Workspaces.id });
      if (!deleted.length)
        throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
    });
    return { status: "deleted" as const };
  });
}

async function markOperationFailed(
  env: WorkflowEnvironment,
  params: ArmWorkspaceWorkflowParams,
  code: string,
) {
  const provider = new ArmWorkspaceProvider();
  let cleanupSucceeded = false;
  if (params.kind === "start") {
    try {
      await stopResourceGenerations(provider, params.workspaceId, null, null, [
        params.resourceGeneration,
        params.cleanupGeneration,
      ]);
      cleanupSucceeded = true;
    } catch {
      cleanupSucceeded = false;
    }
  }
  await withWorkflowDatabase(env, async (db) => {
    const [current] = await db
      .select({ id: schema.gen2Workspaces.id })
      .from(schema.gen2Workspaces)
      .where(operationWhere(params))
      .limit(1);
    if (!current) return;
    await db
      .update(schema.gen2Workspaces)
      .set({
        status: params.kind === "delete" ? "deleting" : "failed",
        runtimeStatus: "failed",
        ...(cleanupSucceeded
          ? {
              runtimeVmResourceId: null,
              runtimeTunnelId: null,
              runtimeRouteHost: null,
              runtimeCleanupGeneration: null,
            }
          : {}),
        lastError: errorMessage(code),
        runtimeOperationStartedAt: new Date(),
        runtimeLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(operationWhere(params));
    if (cleanupSucceeded) {
      await endComputeSession(db, params.workspaceId);
      await releaseFreeWorkspaceCompute(db, params.workspaceId);
    }
  });
  logEvent("error", "gen2.azure_runtime.operation_failed", {
    workspaceId: params.workspaceId,
    operationId: params.operationId,
    generation: params.generation,
    code,
  });
}

export async function runArmWorkspaceLifecycle(
  env: WorkflowEnvironment,
  params: ArmWorkspaceWorkflowParams,
  step: WorkflowStep,
) {
  try {
    await step.do(
      `arm-${params.kind}-${params.generation}`,
      {
        timeout: "15 minutes",
        retries: { limit: 4, delay: "10 seconds", backoff: "exponential" },
      },
      async () => {
        await executeOperation(env, params);
        return { complete: true };
      },
    );
  } catch (error) {
    await markOperationFailed(env, params, operationError(error));
  }
}

export async function reconcileArmWorkspaceOperations() {
  const now = new Date();
  const rows = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      runtimeGeneration: schema.gen2Workspaces.runtimeGeneration,
      runtimeOperationId: schema.gen2Workspaces.runtimeOperationId,
      runtimeOperationKind: schema.gen2Workspaces.runtimeOperationKind,
      runtimeOperationStartedAt:
        schema.gen2Workspaces.runtimeOperationStartedAt,
      runtimeLeaseExpiresAt: schema.gen2Workspaces.runtimeLeaseExpiresAt,
      runtimeCleanupGeneration: schema.gen2Workspaces.runtimeCleanupGeneration,
      runtimeVmResourceId: schema.gen2Workspaces.runtimeVmResourceId,
      runtimeStatus: schema.gen2Workspaces.runtimeStatus,
    })
    .from(schema.gen2Workspaces)
    .where(
      and(
        eq(schema.gen2Workspaces.runtimeProvider, "azure_arm"),
        or(
          inArray(schema.gen2Workspaces.runtimeStatus, ACTIVE_STATES),
          and(
            eq(schema.gen2Workspaces.runtimeStatus, "failed"),
            inArray(schema.gen2Workspaces.runtimeOperationKind, [
              "stop",
              "delete",
            ]),
            lt(
              schema.gen2Workspaces.runtimeOperationStartedAt,
              new Date(now.getTime() - OPERATION_RETRY_DELAY_MS),
            ),
          ),
        ),
        or(
          isNull(schema.gen2Workspaces.runtimeLeaseExpiresAt),
          lt(schema.gen2Workspaces.runtimeLeaseExpiresAt, now),
        ),
      ),
    )
    .limit(20);
  for (const row of rows) {
    if (!row.runtimeOperationId || !row.runtimeOperationKind) continue;
    let binding: WorkflowBinding;
    try {
      binding = workflowBinding();
    } catch {
      return;
    }
    let existingStatus: string | undefined;
    try {
      const instance = await binding.get(row.runtimeOperationId);
      existingStatus = (await instance.status()).status;
    } catch {
      // Missing instance is recreated with the original operation ID.
    }
    if (
      ["queued", "running", "paused", "waiting", "waitingForPause"].includes(
        existingStatus ?? "",
      )
    ) {
      await getDatabase()
        .update(schema.gen2Workspaces)
        .set({
          runtimeLeaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
          runtimeOperationStartedAt: new Date(),
        })
        .where(
          and(
            eq(schema.gen2Workspaces.id, row.id),
            eq(
              schema.gen2Workspaces.runtimeOperationId,
              row.runtimeOperationId,
            ),
            eq(schema.gen2Workspaces.runtimeGeneration, row.runtimeGeneration),
          ),
        );
      continue;
    }
    if (existingStatus === "complete" || existingStatus === "errored") {
      const replacementId = crypto.randomUUID();
      const [updated] = await getDatabase()
        .update(schema.gen2Workspaces)
        .set({
          runtimeOperationId: replacementId,
          runtimeLeaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
          runtimeOperationStartedAt: new Date(),
        })
        .where(
          and(
            eq(schema.gen2Workspaces.id, row.id),
            eq(
              schema.gen2Workspaces.runtimeOperationId,
              row.runtimeOperationId,
            ),
            eq(schema.gen2Workspaces.runtimeGeneration, row.runtimeGeneration),
          ),
        )
        .returning({ id: schema.gen2Workspaces.id });
      if (!updated) continue;
      row.runtimeOperationId = replacementId;
    }
    const params: ArmWorkspaceWorkflowParams = {
      workspaceId: row.id,
      operationId: row.runtimeOperationId,
      generation: row.runtimeGeneration,
      resourceGeneration: row.runtimeGeneration,
      cleanupGeneration: row.runtimeCleanupGeneration,
      kind: row.runtimeOperationKind,
    };
    await createOrJoinWorkflow(params).catch((error) =>
      logEvent("error", "gen2.azure_runtime.reconcile_failed", {
        workspaceId: row.id,
        operationId: row.runtimeOperationId,
        generation: row.runtimeGeneration,
        code: operationError(error),
      }),
    );
  }
}

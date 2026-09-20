import "server-only";

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { schema } from "@codev/db";
import { readServerEnvironment } from "@codev/config";
import { z } from "zod";

import { getDatabase } from "../platform/database";

const workspaceIdSchema = z.string().uuid();

const runtimeHostInputSchema = z.object({
  providerId: z.string().min(1),
  runtimeAddress: z.url(),
  maxWorkspaceSlots: z.number().int().positive(),
  freeWorkspaceSlots: z.number().int().min(0),
  imageVersion: z.string().min(1).nullable().optional(),
});

export type RuntimeHostLease = {
  hostId: string;
  providerId: string;
  runtimeAddress: string;
  lifecycleState: "provisioning" | "ready" | "draining" | "stopped" | "failed";
  generation: number;
  fencingToken: string;
  diskId: string | null;
  imageVersion: string | null;
};

const ACTIVE_ASSIGNMENT_STATES = [
  "assigned",
  "starting",
  "ready",
  "draining",
] as const;

export function isRuntimeHostPoolEnabled() {
  return readServerEnvironment().CODEV_RUNTIME_HOST_POOL_ENABLED === "true";
}

/**
 * Make the current single-host deployment visible to the scheduler on first
 * use. VMSS/standby controllers will call `registerRuntimeHost` for additional
 * hosts; this fallback keeps enabling the flag a safe, zero-downtime rollout
 * for the host that is already configured in Vercel.
 */
async function ensureConfiguredRuntimeHost() {
  const environment = readServerEnvironment();
  const providerId = environment.AZURE_HOST_VM_NAME?.trim();
  const runtimeAddress = environment.ORCHESTRATOR_DIRECT_URL;
  if (!providerId || !runtimeAddress) return;

  const now = new Date();
  await getDatabase()
    .insert(schema.runtimeHosts)
    .values({
      providerId,
      runtimeAddress,
      lifecycleState: "ready",
      maxWorkspaceSlots: 4,
      freeWorkspaceSlots: 4,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.runtimeHosts.providerId });
}

function toLease(row: {
  hostId: string;
  providerId: string;
  runtimeAddress: string;
  lifecycleState: RuntimeHostLease["lifecycleState"];
  generation: number;
  fencingToken: string;
  diskId: string | null;
  imageVersion: string | null;
}): RuntimeHostLease {
  return row;
}

/**
 * Resolve the host currently fenced for a workspace. Requests use this on
 * every call instead of caching an address, so a reassignment takes effect
 * without restarting the web process.
 */
export async function resolveRuntimeHostForWorkspace(
  workspaceId: string,
): Promise<RuntimeHostLease | null> {
  if (!isRuntimeHostPoolEnabled()) return null;
  const id = workspaceIdSchema.parse(workspaceId);
  const [row] = await getDatabase()
    .select({
      hostId: schema.runtimeHosts.id,
      providerId: schema.runtimeHosts.providerId,
      runtimeAddress: schema.runtimeHosts.runtimeAddress,
      lifecycleState: schema.runtimeHosts.lifecycleState,
      generation: schema.workspaceRuntimeAssignments.generation,
      fencingToken: schema.workspaceRuntimeAssignments.fencingToken,
      diskId: schema.workspaceRuntimeAssignments.diskId,
      imageVersion: schema.runtimeHosts.imageVersion,
    })
    .from(schema.workspaceRuntimeAssignments)
    .innerJoin(
      schema.runtimeHosts,
      eq(schema.runtimeHosts.id, schema.workspaceRuntimeAssignments.hostId),
    )
    .where(
      and(
        eq(schema.workspaceRuntimeAssignments.workspaceId, id),
        inArray(
          schema.workspaceRuntimeAssignments.runtimeState,
          ACTIVE_ASSIGNMENT_STATES,
        ),
        inArray(schema.runtimeHosts.lifecycleState, ["ready", "draining"]),
      ),
    )
    .limit(1);

  return row ? toLease(row) : null;
}

/**
 * Atomically claim one free prepared host for a workspace. The workspace row
 * is the lock that serializes concurrent opens for the same workspace, while
 * the selected host row serializes capacity claims across workspaces.
 */
export async function ensureRuntimeHostAssignment(
  workspaceId: string,
): Promise<RuntimeHostLease | null> {
  if (!isRuntimeHostPoolEnabled()) return null;
  const id = workspaceIdSchema.parse(workspaceId);
  await ensureConfiguredRuntimeHost();
  const now = new Date();

  return getDatabase().transaction(async (transaction) => {
    const [workspace] = await transaction
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1)
      .for("update");
    if (!workspace) return null;

    const [existing] = await transaction
      .select({
        hostId: schema.runtimeHosts.id,
        providerId: schema.runtimeHosts.providerId,
        runtimeAddress: schema.runtimeHosts.runtimeAddress,
        lifecycleState: schema.runtimeHosts.lifecycleState,
        generation: schema.workspaceRuntimeAssignments.generation,
        fencingToken: schema.workspaceRuntimeAssignments.fencingToken,
        diskId: schema.workspaceRuntimeAssignments.diskId,
        imageVersion: schema.runtimeHosts.imageVersion,
        assignmentState: schema.workspaceRuntimeAssignments.runtimeState,
      })
      .from(schema.workspaceRuntimeAssignments)
      .innerJoin(
        schema.runtimeHosts,
        eq(schema.runtimeHosts.id, schema.workspaceRuntimeAssignments.hostId),
      )
      .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id))
      .limit(1)
      .for("update");

    if (
      existing &&
      existing.assignmentState !== "lost" &&
      ACTIVE_ASSIGNMENT_STATES.includes(existing.assignmentState) &&
      ["ready", "draining"].includes(existing.lifecycleState)
    ) {
      await transaction
        .update(schema.workspaceRuntimeAssignments)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id));
      return toLease(existing);
    }

    // A stopped or failed host invalidates the old placement. Keep the row so
    // the next placement increments its generation and rotates the fence.
    const previousGeneration = existing?.generation ?? 0;
    const [host] = await transaction
      .select({
        id: schema.runtimeHosts.id,
        providerId: schema.runtimeHosts.providerId,
        runtimeAddress: schema.runtimeHosts.runtimeAddress,
        lifecycleState: schema.runtimeHosts.lifecycleState,
        imageVersion: schema.runtimeHosts.imageVersion,
        freeWorkspaceSlots: schema.runtimeHosts.freeWorkspaceSlots,
      })
      .from(schema.runtimeHosts)
      .where(
        and(
          eq(schema.runtimeHosts.lifecycleState, "ready"),
          gt(schema.runtimeHosts.freeWorkspaceSlots, 0),
        ),
      )
      .orderBy(
        desc(schema.runtimeHosts.freeWorkspaceSlots),
        asc(schema.runtimeHosts.lastHeartbeatAt),
        asc(schema.runtimeHosts.createdAt),
      )
      .limit(1)
      .for("update");

    if (!host) {
      if (existing && existing.assignmentState !== "lost") {
        await transaction
          .update(schema.workspaceRuntimeAssignments)
          .set({ runtimeState: "lost", updatedAt: now })
          .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id));
      }
      return null;
    }

    await transaction
      .update(schema.runtimeHosts)
      .set({
        freeWorkspaceSlots: sql`${schema.runtimeHosts.freeWorkspaceSlots} - 1`,
        updatedAt: now,
      })
      .where(eq(schema.runtimeHosts.id, host.id));

    const generation = previousGeneration + 1;
    const fencingToken = crypto.randomUUID();
    if (existing) {
      await transaction
        .update(schema.workspaceRuntimeAssignments)
        .set({
          hostId: host.id,
          generation,
          fencingToken,
          runtimeState: "assigned",
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id));
    } else {
      await transaction.insert(schema.workspaceRuntimeAssignments).values({
        workspaceId: id,
        hostId: host.id,
        generation,
        fencingToken,
        runtimeState: "assigned",
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      hostId: host.id,
      providerId: host.providerId,
      runtimeAddress: host.runtimeAddress,
      lifecycleState: host.lifecycleState,
      generation,
      fencingToken,
      diskId: existing?.diskId ?? null,
      imageVersion: host.imageVersion,
    } satisfies RuntimeHostLease;
  });
}

/** Register or refresh a prepared host in the scheduler inventory. */
export async function registerRuntimeHost(input: {
  providerId: string;
  runtimeAddress: string;
  maxWorkspaceSlots: number;
  freeWorkspaceSlots: number;
  imageVersion?: string | null;
}) {
  const value = runtimeHostInputSchema.parse(input);
  const now = new Date();
  const [host] = await getDatabase()
    .insert(schema.runtimeHosts)
    .values({
      providerId: value.providerId,
      runtimeAddress: value.runtimeAddress,
      lifecycleState: "ready",
      maxWorkspaceSlots: value.maxWorkspaceSlots,
      freeWorkspaceSlots: value.freeWorkspaceSlots,
      imageVersion: value.imageVersion ?? null,
      lastHeartbeatAt: now,
      lastError: null,
      drainingAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.runtimeHosts.providerId,
      set: {
        runtimeAddress: value.runtimeAddress,
        lifecycleState: "ready",
        maxWorkspaceSlots: value.maxWorkspaceSlots,
        freeWorkspaceSlots: value.freeWorkspaceSlots,
        imageVersion: value.imageVersion ?? null,
        lastHeartbeatAt: now,
        drainingAt: null,
        lastError: null,
        updatedAt: now,
      },
    })
    .returning();
  return host ?? null;
}

/** Release a workspace's capacity slot after its writable runtime is stopped. */
export async function releaseRuntimeHostAssignment(workspaceId: string) {
  if (!isRuntimeHostPoolEnabled()) return;
  const id = workspaceIdSchema.parse(workspaceId);
  const now = new Date();

  await getDatabase().transaction(async (transaction) => {
    const [assignment] = await transaction
      .select({
        hostId: schema.workspaceRuntimeAssignments.hostId,
        runtimeState: schema.workspaceRuntimeAssignments.runtimeState,
      })
      .from(schema.workspaceRuntimeAssignments)
      .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id))
      .limit(1)
      .for("update");
    if (!assignment || assignment.runtimeState === "lost") return;

    await transaction
      .update(schema.runtimeHosts)
      .set({
        freeWorkspaceSlots: sql`
          LEAST(
            ${schema.runtimeHosts.maxWorkspaceSlots},
            ${schema.runtimeHosts.freeWorkspaceSlots} + 1
          )
        `,
        updatedAt: now,
      })
      .where(eq(schema.runtimeHosts.id, assignment.hostId));
    await transaction
      .update(schema.workspaceRuntimeAssignments)
      .set({ runtimeState: "lost", updatedAt: now })
      .where(eq(schema.workspaceRuntimeAssignments.workspaceId, id));
  });
}

/** Mark a host as draining so new workspaces avoid it while current ones stay put. */
export async function drainRuntimeHost(providerId: string) {
  const id = z.string().min(1).parse(providerId);
  const now = new Date();
  await getDatabase()
    .update(schema.runtimeHosts)
    .set({ lifecycleState: "draining", drainingAt: now, updatedAt: now })
    .where(eq(schema.runtimeHosts.providerId, id));
}

/**
 * Mark every assignment on a failed host as lost. A later workspace open can
 * then acquire a replacement host with a new generation and fence.
 */
export async function markRuntimeHostLost(providerId: string) {
  const id = z.string().min(1).parse(providerId);
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    const [host] = await transaction
      .select({ id: schema.runtimeHosts.id })
      .from(schema.runtimeHosts)
      .where(eq(schema.runtimeHosts.providerId, id))
      .limit(1)
      .for("update");
    if (!host) return;

    await transaction
      .update(schema.runtimeHosts)
      .set({ lifecycleState: "failed", lastHeartbeatAt: now, updatedAt: now })
      .where(eq(schema.runtimeHosts.id, host.id));
    await transaction
      .update(schema.workspaceRuntimeAssignments)
      .set({ runtimeState: "lost", updatedAt: now })
      .where(eq(schema.workspaceRuntimeAssignments.hostId, host.id));
  });
}

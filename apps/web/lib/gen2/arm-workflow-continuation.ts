import "server-only";
import type { WorkflowStep } from "cloudflare:workers";
import type { ArmWorkspaceWorkflowParams } from "@codev/contracts";
import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";
import type { WorkflowBinding } from "./arm-workflow-binding";
import { withArmWorkflowDatabase } from "./arm-workflow-database";
import { ArmWorkspaceRuntimeError } from "../runtime/arm-workspace-error";

type Environment = Parameters<typeof withArmWorkflowDatabase>[0] & {
  GEN2_ARM_WORKSPACE_LIFECYCLE?: WorkflowBinding;
};

async function continuationId(operationId: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${operationId}:continue`),
  );
  const hex = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function claim(
  env: Environment,
  params: ArmWorkspaceWorkflowParams,
  nextId: string,
) {
  return withArmWorkflowDatabase(env, async (db) => {
    const where = and(
      eq(schema.gen2Workspaces.id, params.workspaceId),
      eq(schema.gen2Workspaces.runtimeGeneration, params.generation),
    );
    const [row] = await db
      .select()
      .from(schema.gen2Workspaces)
      .where(where)
      .limit(1);
    if (
      !row ||
      ![params.operationId, nextId].includes(row.runtimeOperationId ?? "")
    )
      throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
    if (row.runtimeOperationId === nextId) return row;
    const [updated] = await db
      .update(schema.gen2Workspaces)
      .set({
        runtimeOperationId: nextId,
        runtimeLeaseExpiresAt: new Date(Date.now() + 20 * 60_000),
        updatedAt: new Date(),
      })
      .where(
        and(
          where,
          eq(schema.gen2Workspaces.runtimeOperationId, params.operationId),
        ),
      )
      .returning();
    if (!updated) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
    return updated;
  });
}

async function activate(
  binding: WorkflowBinding,
  next: ArmWorkspaceWorkflowParams,
) {
  try {
    await binding.create({ id: next.operationId, params: next });
  } catch {
    await binding.get(next.operationId);
  }
  const child = await binding.get(next.operationId);
  if (!child.sendEvent) throw new Error("ARM_WORKFLOW_EVENT_BINDING_MISSING");
  await child.sendEvent({ type: "handoff-ready", payload: {} });
}

function continuationParams(
  params: ArmWorkspaceWorkflowParams,
  nextId: string,
  row: typeof schema.gen2Workspaces.$inferSelect,
  checkpoints: Record<string, unknown>,
) {
  const input = Object.entries(checkpoints).find(([key]) =>
    key.endsWith("-input"),
  )?.[1] as { runtimeStatus?: string } | undefined;
  const compact =
    !params.failureCode &&
    [
      "booting",
      "attaching_disk",
      "starting_tunnel",
      "checking_readiness",
    ].includes(row.runtimeStatus) &&
    row.runtimeStatus !== input?.runtimeStatus;
  return {
    ...params,
    operationId: nextId,
    activate: true,
    checkpoints: compact ? {} : checkpoints,
    cleanupGeneration: compact
      ? row.runtimeCleanupGeneration
      : params.cleanupGeneration,
  };
}

/** Hand off before the free-plan budget is exhausted, fencing activation. */
export async function continueArmWorkspaceWorkflow(
  env: Environment,
  params: ArmWorkspaceWorkflowParams,
  step: WorkflowStep,
  checkpoints: Record<string, unknown>,
) {
  const nextId = await continuationId(params.operationId);
  await step.do(
    "handoff",
    { retries: { limit: 4, delay: "10 seconds", backoff: "exponential" } },
    async () => {
      const binding = env.GEN2_ARM_WORKSPACE_LIFECYCLE;
      if (!binding) throw new Error("ARM_WORKFLOW_BINDING_MISSING");
      const row = await claim(env, params, nextId);
      await activate(
        binding,
        continuationParams(params, nextId, row, checkpoints),
      );
      return { continuationId: nextId };
    },
  );
}

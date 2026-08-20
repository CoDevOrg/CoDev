import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { schema } from "@codev/db";

import { getWorkspaceCreditStatus } from "./compute-credits";
import { getDatabase } from "./database";
import { consumeRateLimit } from "./rate-limit";
import { getVmMinutesUsed, VM_MINUTE_LIFETIME_QUOTA } from "./vm-usage";

export class QuotaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds = 60,
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

export async function assertWorkspaceQuota(userId: string) {
  const rate = await consumeRateLimit(userId, "workspace-create", 5, 3_600);
  if (!rate.allowed) {
    throw new QuotaError(
      "Workspace creation rate limit reached.",
      "workspace_rate_limit",
      rate.retryAfterSeconds,
    );
  }
  const [result] = await getDatabase()
    .select({ value: count() })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.ownerId, userId),
        inArray(schema.workspaces.status, [
          "pending",
          "provisioning",
          "ready",
          "stopping",
        ]),
      ),
    );
  if ((result?.value ?? 0) >= 3) {
    throw new QuotaError(
      "You can have at most three active workspaces.",
      "active_workspace_limit",
      300,
    );
  }
}

export async function assertTurnQuota(userId: string, sessionId: string) {
  const [queued] = await getDatabase()
    .select({ value: count() })
    .from(schema.agentTurns)
    .where(
      and(
        eq(schema.agentTurns.sessionId, sessionId),
        inArray(schema.agentTurns.status, ["queued", "running"]),
      ),
    );
  if ((queued?.value ?? 0) >= 2) {
    throw new QuotaError(
      "This agent already has two queued or running turns.",
      "queued_turn_limit",
      30,
    );
  }
}

export async function assertVmMinuteQuota(ownerId: string) {
  const used = await getVmMinutesUsed(ownerId);
  if (used >= VM_MINUTE_LIFETIME_QUOTA) {
    throw new QuotaError(
      `Lifetime VM minute allotment exhausted (${VM_MINUTE_LIFETIME_QUOTA} minutes).`,
      "vm_minute_quota",
      86_400,
    );
  }
}

/**
 * The beta's actual cost ceiling: $5/member/month pooled across a
 * workspace, replacing assertVmMinuteQuota as the primary gate everywhere
 * compute starts (see compute-credits.ts for the accounting). Hard-blocks
 * once exhausted — the workspace's files and agent-session history stay
 * fully readable regardless, since this only guards starting new compute.
 */
export async function assertWorkspaceCreditQuota(workspaceId: string) {
  const { remainingMinutes } = await getWorkspaceCreditStatus(workspaceId);
  if (remainingMinutes <= 0) {
    throw new QuotaError(
      "This workspace's monthly compute credit is used up. It resets next month, or another member can free up credit.",
      "workspace_credit_quota",
      3_600,
    );
  }
}

export function quotaResponse(error: QuotaError) {
  return Response.json(
    { error: error.message, code: error.code },
    {
      status: 429,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    },
  );
}

import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { consumeRateLimit } from "./rate-limit";

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

export function quotaResponse(error: QuotaError) {
  return Response.json(
    { error: error.message, code: error.code },
    {
      status: 429,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    },
  );
}

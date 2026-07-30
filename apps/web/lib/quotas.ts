import "server-only";

import { and, count, eq, gte, inArray } from "drizzle-orm";

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
  const rate = await consumeRateLimit(userId, "agent-turn", 30, 3_600);
  if (!rate.allowed) {
    throw new QuotaError(
      "Agent turn rate limit reached.",
      "turn_rate_limit",
      rate.retryAfterSeconds,
    );
  }
  const [queued, daily] = await Promise.all([
    getDatabase()
      .select({ value: count() })
      .from(schema.agentTurns)
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          inArray(schema.agentTurns.status, ["queued", "running"]),
        ),
      ),
    getDatabase()
      .select({ value: count() })
      .from(schema.agentTurns)
      .where(
        and(
          eq(schema.agentTurns.authorId, userId),
          gte(
            schema.agentTurns.createdAt,
            new Date(Date.now() - 24 * 60 * 60 * 1_000),
          ),
        ),
      ),
  ]);
  if ((queued[0]?.value ?? 0) >= 2) {
    throw new QuotaError(
      "This agent already has two queued or running turns.",
      "queued_turn_limit",
      30,
    );
  }
  if ((daily[0]?.value ?? 0) >= 100) {
    throw new QuotaError(
      "The daily agent turn budget is exhausted.",
      "daily_turn_limit",
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

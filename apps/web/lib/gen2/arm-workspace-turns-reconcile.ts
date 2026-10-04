import "server-only";

import { and, asc, eq, lt } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { pollGen2AgentTurn } from "./agent";

/** Drain abandoned ARM turns before their VM can be released; never wake a guest. */
export async function reconcileArmWorkspaceTurns(now = new Date()) {
  const turns = await getDatabase()
    .select({
      workspaceId: schema.gen2AgentTurns.workspaceId,
      sessionId: schema.gen2AgentTurns.sessionId,
      userId: schema.gen2AgentTurns.userId,
      nextSequence: schema.gen2AgentTurns.nextSequence,
    })
    .from(schema.gen2AgentTurns)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2Workspaces.id, schema.gen2AgentTurns.workspaceId),
    )
    .where(
      and(
        eq(schema.gen2Workspaces.runtimeProvider, "azure_arm"),
        eq(schema.gen2Workspaces.runtimeStatus, "ready"),
        eq(schema.gen2AgentTurns.exited, false),
        lt(schema.gen2AgentTurns.updatedAt, new Date(now.getTime() - 60_000)),
      ),
    )
    .orderBy(asc(schema.gen2AgentTurns.updatedAt))
    .limit(8);
  await Promise.all(
    turns.map(async (turn) => {
      try {
        await pollGen2AgentTurn({ ...turn, after: turn.nextSequence });
        // Superset snapshots with no new output otherwise leave an old timestamp.
        await getDatabase()
          .update(schema.gen2AgentTurns)
          .set({ updatedAt: now })
          .where(eq(schema.gen2AgentTurns.sessionId, turn.sessionId));
      } catch {
        logEvent("warn", "gen2.arm.turn_drain_failed", {
          workspaceId: turn.workspaceId,
          sessionId: turn.sessionId,
        });
      }
    }),
  );
}

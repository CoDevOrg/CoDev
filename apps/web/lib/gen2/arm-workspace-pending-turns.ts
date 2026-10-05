import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";

/** An unpersisted reply must not disappear with an idle VM's memory. */
export async function hasPendingArmWorkspaceTurns(workspaceId: string) {
  const [turn] = await getDatabase()
    .select({ sessionId: schema.gen2AgentTurns.sessionId })
    .from(schema.gen2AgentTurns)
    .where(
      and(
        eq(schema.gen2AgentTurns.workspaceId, workspaceId),
        eq(schema.gen2AgentTurns.exited, false),
      ),
    )
    .limit(1);
  return Boolean(turn);
}

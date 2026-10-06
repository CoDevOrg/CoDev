import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { updateCursorAuthCache } from "../providers/cursor-auth-refresh";

/** A shared-workspace poll refreshes the initiating member's login. */
export async function refreshCursorTurnAuth(
  sessionId: string,
  contents: string,
) {
  const [turn] = await getDatabase()
    .select({ userId: schema.gen2AgentTurns.userId })
    .from(schema.gen2AgentTurns)
    .where(
      and(
        eq(schema.gen2AgentTurns.sessionId, sessionId),
        eq(schema.gen2AgentTurns.provider, "cursor"),
      ),
    )
    .limit(1);
  if (!turn) return;
  try {
    await updateCursorAuthCache(turn.userId, contents);
  } catch {
    logEvent("warn", "gen2.cursor.auth_refresh_failed", { sessionId });
  }
}

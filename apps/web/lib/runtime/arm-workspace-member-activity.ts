import "server-only";

import { schema } from "@codev/db";
import { and, eq, exists, isNull } from "drizzle-orm";

import { getDatabase } from "../platform/database";

/** Idle stops come after 15 minutes, so typing needs one write per interval. */
const RECORD_INTERVAL_MS = 30_000;
const recordedAt = new Map<string, number>();

/** Successful member mutations count as input; reads and polls never do. */
export async function recordArmWorkspaceMemberActivity(
  workspaceId: string,
  generation: number,
  method: string,
  path: string,
) {
  if (
    method !== "POST" ||
    !/^\/v1\/(?:files\/write|pty\/exec|terminals(?:\/[^/]+\/input)?|codex-execs|superset-agents(?:\/[^/]+\/input)?|superset\/(?:file\/write|entry\/(?:create|move|delete)|runtime\/(?:worktrees|terminal\/(?:start|input))))$/.test(
      path,
    )
  )
    return;
  const key = `${workspaceId}:${generation}`;
  if (Date.now() - (recordedAt.get(key) ?? 0) < RECORD_INTERVAL_MS) return;
  const db = getDatabase();
  await db
    .update(schema.gen2ComputeSessions)
    .set({ lastActivityAt: new Date() })
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
        exists(
          db
            .select({ id: schema.gen2Workspaces.id })
            .from(schema.gen2Workspaces)
            .where(
              and(
                eq(schema.gen2Workspaces.id, workspaceId),
                eq(schema.gen2Workspaces.runtimeGeneration, generation),
                eq(schema.gen2Workspaces.runtimeStatus, "ready"),
              ),
            ),
        ),
      ),
    );
  if (recordedAt.size >= 1_000) recordedAt.clear();
  recordedAt.set(key, Date.now());
}

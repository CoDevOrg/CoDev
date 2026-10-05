import "server-only";

import { schema } from "@codev/db";
import { and, eq, exists, isNull } from "drizzle-orm";

import { getDatabase } from "../platform/database";

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
}

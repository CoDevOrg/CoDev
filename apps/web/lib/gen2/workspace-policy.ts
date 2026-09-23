import "server-only";

import type { Gen2AgentExecutionPolicy } from "@codev/contracts";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  requireWorkspacePermission,
  type WorkspaceAccess,
} from "../policies/workspace";
import { getDatabase } from "../platform/database";
import { Gen2AccessError } from "./errors";
import { resolveGen2AgentExecutionPolicy } from "./execution-policy";

async function readGen2AgentExecutionPolicy(
  workspaceId: string,
): Promise<Gen2AgentExecutionPolicy> {
  const [row] = await getDatabase()
    .select({ allowFileChanges: schema.gen2Workspaces.agentFileChanges })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new Gen2AccessError();
  return resolveGen2AgentExecutionPolicy(row);
}

/** Members may see the effective policy; only managers may alter it. */
export async function getGen2AgentExecutionPolicy(
  workspaceId: string,
  userId: string,
) {
  await requireWorkspacePermission(workspaceId, userId, "workspace.view");
  return readGen2AgentExecutionPolicy(workspaceId);
}

/** Used after a turn authorization has already resolved the caller. */
export async function getGen2AgentExecutionPolicyForAccess(
  workspaceId: string,
  access: WorkspaceAccess,
) {
  // Accept resolved server authority, rather than a client user id, so this
  // loader cannot become an alternate authorization path.
  void access;
  return readGen2AgentExecutionPolicy(workspaceId);
}

export async function updateGen2AgentExecutionPolicy(input: {
  workspaceId: string;
  userId: string;
  policy: Gen2AgentExecutionPolicy;
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "workspace.managePolicy",
  );
  const [row] = await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      agentFileChanges: input.policy.allowFileChanges,
      updatedAt: new Date(),
    })
    .where(eq(schema.gen2Workspaces.id, input.workspaceId))
    .returning({ allowFileChanges: schema.gen2Workspaces.agentFileChanges });
  if (!row) throw new Gen2AccessError();
  return resolveGen2AgentExecutionPolicy(row);
}

import "server-only";

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema } from "@codev/db";
import type { getDatabase } from "../platform/database";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

/** Preserve other owners' history, with no link to the deleted profile. */
export async function detachSharedAttribution(db: Transaction, userId: string) {
  const id = randomUUID();
  await db
    .insert(schema.users)
    .values({ id, login: `deleted-${id}`, name: "Deleted account" });
  const references = [
    [schema.agentSessions, schema.agentSessions.createdBy],
    [schema.agentSessionImports, schema.agentSessionImports.importedBy],
    [schema.agentTurns, schema.agentTurns.authorId],
    [
      schema.collaborationConflictResolutions,
      schema.collaborationConflictResolutions.resolvedBy,
    ],
    [schema.publishedBranches, schema.publishedBranches.publishedBy],
    [
      schema.workspaceChatPromptReceipts,
      schema.workspaceChatPromptReceipts.authorId,
    ],
    [schema.gen2Chats, schema.gen2Chats.createdByUserId],
    [schema.gen2SupersetRuns, schema.gen2SupersetRuns.createdBy],
  ] as const;
  for (const [table, column] of references) {
    await db.execute(
      sql`UPDATE ${table} SET ${sql.identifier(column.name)} = ${id} WHERE ${column} = ${userId}`,
    );
  }
  await db
    .update(schema.gen2Workspaces)
    .set({
      activeInviteCreatedByUserId: null,
      activeInviteTokenHash: null,
      activeInviteRole: null,
      activeInviteCreatedAt: null,
      activeInviteExpiresAt: null,
    })
    .where(eq(schema.gen2Workspaces.activeInviteCreatedByUserId, userId));
}

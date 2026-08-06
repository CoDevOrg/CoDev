import "server-only";

import { sql } from "drizzle-orm";

import type { getDatabase } from "@/lib/database";

type Database = ReturnType<typeof getDatabase>;

/**
 * Merge the target identity into the existing GitHub identity while keeping
 * the GitHub record as the canonical user. This is used only after the same
 * browser has authenticated both identities during account linking.
 */
export async function mergeUserIntoCanonical(
  database: Database,
  canonicalUserId: string,
  targetUserId: string,
) {
  if (canonicalUserId === targetUserId) return;

  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      DELETE FROM provider_credentials AS duplicate
      USING provider_credentials AS canonical
      WHERE duplicate.scope_type = 'USER'
        AND duplicate.scope_id = ${targetUserId}
        AND canonical.scope_type = 'USER'
        AND canonical.scope_id = ${canonicalUserId}
        AND duplicate.provider = canonical.provider
        AND duplicate.credential_type = canonical.credential_type
    `);
    await transaction.execute(sql`
      UPDATE provider_credentials
      SET scope_id = ${canonicalUserId}
      WHERE scope_type = 'USER' AND scope_id = ${targetUserId}
    `);

    await transaction.execute(sql`
      DELETE FROM github_connections
      WHERE user_id = ${targetUserId}
    `);

    await transaction.execute(sql`
      UPDATE workspaces
      SET owner_id = ${canonicalUserId}
      WHERE owner_id = ${targetUserId}
    `);
    await transaction.execute(sql`
      INSERT INTO workspace_members (
        workspace_id,
        user_id,
        role,
        access_role,
        can_terminal,
        can_merge,
        joined_at
      )
      SELECT
        workspace_id,
        ${canonicalUserId},
        role,
        access_role,
        can_terminal,
        can_merge,
        joined_at
      FROM workspace_members
      WHERE user_id = ${targetUserId}
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `);
    await transaction.execute(sql`
      DELETE FROM workspace_members
      WHERE user_id = ${targetUserId}
    `);

    await transaction.execute(sql`
      UPDATE design_partner_feedback
      SET user_id = ${canonicalUserId}
      WHERE user_id = ${targetUserId}
    `);
    await transaction.execute(sql`
      DELETE FROM user_environment_variables AS duplicate
      USING user_environment_variables AS canonical
      WHERE duplicate.user_id = ${targetUserId}
        AND canonical.user_id = ${canonicalUserId}
        AND duplicate.name = canonical.name
    `);
    await transaction.execute(sql`
      UPDATE user_environment_variables
      SET user_id = ${canonicalUserId}
      WHERE user_id = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE workspace_invites
      SET created_by = ${canonicalUserId}
      WHERE created_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE workspace_invites
      SET accepted_by = ${canonicalUserId}
      WHERE accepted_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE worktrees
      SET reviewed_by = ${canonicalUserId}
      WHERE reviewed_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE agent_sessions
      SET created_by = ${canonicalUserId}
      WHERE created_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE agent_turns
      SET author_id = ${canonicalUserId}
      WHERE author_id = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE workspace_events
      SET actor_id = ${canonicalUserId}
      WHERE actor_id = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE yjs_snapshots
      SET conflict_resolved_by = ${canonicalUserId}
      WHERE conflict_resolved_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE collaboration_conflict_resolutions
      SET resolved_by = ${canonicalUserId}
      WHERE resolved_by = ${targetUserId}
    `);
    await transaction.execute(sql`
      UPDATE published_branches
      SET published_by = ${canonicalUserId}
      WHERE published_by = ${targetUserId}
    `);

    await transaction.execute(sql`
      DELETE FROM users
      WHERE id = ${targetUserId}
    `);
  });
}

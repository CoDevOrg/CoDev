import "server-only";

import { sql } from "drizzle-orm";
import { ApiError } from "../http/api-route";
import type { getDatabase } from "../platform/database";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export async function assertAccountCanBeDeleted(
  db: Transaction,
  userId: string,
) {
  const {
    rows: [state],
  } = await db.execute<{
    owned: boolean;
    legacy: boolean;
    organization: boolean;
    running: boolean;
  }>(sql`SELECT
    EXISTS(SELECT 1 FROM gen2_workspaces WHERE owner_id = ${userId}) AS owned,
    EXISTS(SELECT 1 FROM workspaces WHERE owner_id = ${userId}) AS legacy,
    (EXISTS(SELECT 1 FROM organization_members WHERE user_id = ${userId}
      AND role = 'owner' AND organization_id <> ${userId})
      OR EXISTS(SELECT 1 FROM organization_members WHERE organization_id = ${userId}
      AND user_id <> ${userId})) AS organization,
    (EXISTS(SELECT 1 FROM gen2_agent_turns WHERE user_id = ${userId} AND exited = false)
      OR EXISTS(SELECT 1 FROM gen2_superset_runs WHERE created_by = ${userId}
      AND status IN ('creating','running','stopping','recovery_required'))
      OR EXISTS(SELECT 1 FROM claude_connection_sessions WHERE user_id = ${userId}
      AND status IN ('starting','awaiting_code','exchanging') AND expires_at > now())
      OR EXISTS(SELECT 1 FROM provider_credential_runs WHERE user_id = ${userId}
      AND heartbeat_at > now() - interval '2 minutes')) AS running`);
  if (!state)
    throw new ApiError("Could not check account resources. Try again.", 503);
  if (state.owned)
    throw new ApiError(
      "Export your work, then delete your owned workspaces from Workspaces before deleting your account. Workspace deletion also removes its cloud disk.",
      409,
    );
  if (state.legacy)
    throw new ApiError(
      "Your account owns an older workspace. Contact admins@trycodev.com to remove its stored runtime data before account deletion.",
      409,
    );
  if (state.organization)
    throw new ApiError(
      "Transfer organization ownership and move members out of your personal organization before deletion. Contact admins@trycodev.com if you need help.",
      409,
    );
  if (state.running)
    throw new ApiError(
      "Stop your running agents and finish or cancel provider connections before deleting your account.",
      409,
    );
}

import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";

/**
 * The personal-or-workspace credential rule, in one place so every provider
 * resolves it identically.
 *
 * There used to be two conventions for "shared" in the same table:
 * `scopeType: "WORKSPACE"` for the older fallback key pool, and
 * `scopeType: "ORGANIZATION"` with the *workspace's* id as its scope id for
 * the `--org` logins — which meant reading a row required knowing which
 * mechanism had written it, and `defaultSharingEnabled` existed only to tell
 * the two apart. They are now one scope: a `WORKSPACE`-scoped credential
 * belongs to that workspace's members.
 *
 * The `sharing_enabled` column went with it. No caller ever set it; it was
 * always the default implied by the scope, so it recorded nothing a member
 * had decided. What a member does decide — whether their *personal*
 * credential may fund a turn in a workspace others can see — is
 * `allow_in_shared_workspaces`, applied by `resolveCredential`.
 *
 * The rule: a member's own login wins; failing that, the workspace's login,
 * and only for a member who actually belongs to that workspace.
 */

export type ScopedCredentialSource = "USER" | "WORKSPACE";

export type ScopedCredentialResult<T> = {
  credential: T;
  source: ScopedCredentialSource;
};

export async function belongsToSharedScope(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [membership] = await getDatabase()
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

/**
 * Personal row wins; otherwise the workspace's row, gated by membership.
 * `findPersonal`/`findShared` do the provider-specific query — this only
 * sequences them and applies the one gate every provider shares.
 */
export async function resolvePersonalOrSharedCredential<T>(
  input: { userId: string; workspaceId?: string | undefined },
  lookup: {
    findPersonal: (userId: string) => Promise<T | null>;
    findShared: (workspaceId: string) => Promise<T | null>;
  },
): Promise<ScopedCredentialResult<T> | null> {
  const personal = await lookup.findPersonal(input.userId);
  if (personal) return { credential: personal, source: "USER" };
  if (!input.workspaceId) return null;
  const shared = await lookup.findShared(input.workspaceId);
  if (shared && (await belongsToSharedScope(input.userId, input.workspaceId))) {
    return { credential: shared, source: "WORKSPACE" };
  }
  return null;
}

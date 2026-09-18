import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";

/**
 * The personal-vs-shared-workspace-login pattern, factored out so every
 * provider (Codex's hosted subscription, Claude's CLI setup-token, and
 * whatever comes next) resolves it identically instead of re-deriving it.
 *
 * A "shared" credential is not a separate kind of entity — it is a row scoped
 * to a specific workspace (`scopeType: "ORGANIZATION"`, `scopeId` = that
 * workspace's id — "organization" here just means "every member of this
 * workspace", resolved from workspaces the connecting member owns) rather
 * than to one person. The rule, the same for every provider: a member's own
 * login wins; failing that, the workspace's shared login is used only if it
 * was explicitly marked shared *and* the member actually belongs to that
 * workspace. Provider-specific extras (Codex's busy/claim lock, Claude's
 * `connectedVia === 'cli'` requirement) are layered on top by the caller —
 * this only decides *whose* credential to look at.
 */

export type ScopedCredentialSource = "USER" | "ORGANIZATION";

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
 * Personal row wins; otherwise the workspace's shared row, gated by both
 * `sharingEnabled` on that row and actual membership. `findPersonal`/
 * `findShared` do the provider-specific query (and any provider-specific
 * filtering, e.g. Codex's busy check) — this function only sequences them and
 * applies the one gate every provider shares.
 */
export async function resolvePersonalOrSharedCredential<
  T extends { sharingEnabled: boolean | null },
>(
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
  if (
    shared?.sharingEnabled &&
    (await belongsToSharedScope(input.userId, input.workspaceId))
  ) {
    return { credential: shared, source: "ORGANIZATION" };
  }
  return null;
}

/** The default a caller applies unless a member explicitly overrides it: a
 *  workspace-scoped login is shared by default (that is the point of
 *  connecting one that way), a personal one is not. Takes the full credential
 *  scope type — a plain fallback key can be "WORKSPACE"-scoped too, which is a
 *  different, older mechanism (`WorkspaceCredentialForm`) and is never shared
 *  by this rule. */
export function defaultSharingEnabled(
  scopeType: "USER" | "WORKSPACE" | "ORGANIZATION",
): boolean {
  return scopeType === "ORGANIZATION";
}

import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export function personalOrganizationSlug(userId: string) {
  return `personal-${userId.replaceAll("-", "")}`;
}

export function personalOrganizationName(user: {
  name: string | null;
  login: string;
}) {
  const displayName = user.name?.trim() || user.login;
  return `${displayName}'s organization`;
}

/** Idempotently establishes the account boundary required by new workspaces. */
export async function ensurePersonalOrganization(
  transaction: DatabaseTransaction,
  userId: string,
) {
  const [user] = await transaction
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error("Cannot create an organization for this user.");

  await transaction
    .insert(schema.organizations)
    .values({
      id: user.id,
      slug: personalOrganizationSlug(user.id),
      name: personalOrganizationName(user),
    })
    .onConflictDoNothing();
  await transaction
    .insert(schema.organizationMembers)
    .values({ organizationId: user.id, userId: user.id, role: "owner" })
    .onConflictDoNothing();
  await transaction
    .insert(schema.organizationSubscriptions)
    .values({ organizationId: user.id, planId: "free", status: "active" })
    .onConflictDoNothing({
      target: schema.organizationSubscriptions.organizationId,
    });

  return user.id;
}

import "server-only";

import { asc, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import {
  requireOrganizationSettingsAccess,
  type OrganizationSettingsContext,
} from "../auth/settings-access";

export async function getActiveOrganizationSettingsContext(
  userId: string,
): Promise<OrganizationSettingsContext | null> {
  const memberships = await getDatabase()
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .innerJoin(
      schema.organizations,
      eq(schema.organizationMembers.organizationId, schema.organizations.id),
    )
    .where(eq(schema.organizationMembers.userId, userId))
    .orderBy(asc(schema.organizations.createdAt));
  const organization =
    memberships.find(({ role }) => role === "owner" || role === "admin") ??
    memberships[0];
  if (!organization) return null;

  const access = await requireOrganizationSettingsAccess(
    userId,
    organization.id,
    "read",
  );
  return {
    ...access,
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
  };
}

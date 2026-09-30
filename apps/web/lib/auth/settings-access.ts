import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";

export type OrganizationSettingsRole =
  (typeof schema.organizationMembers.$inferSelect)["role"];
export type OrganizationSettingsAction = "read" | "write";

export type OrganizationSettingsAccess = {
  role: OrganizationSettingsRole;
  canWrite: boolean;
  action: OrganizationSettingsAction;
};

export type OrganizationSettingsContext = OrganizationSettingsAccess & {
  organization: { id: string; name: string; slug: string };
};

export class OrganizationSettingsAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OrganizationSettingsAccessError";
  }
}

export function isOrganizationSettingsAdmin(role: OrganizationSettingsRole) {
  return role === "owner" || role === "admin";
}

export async function checkOrgSettingsAccess(
  userId: string,
  organizationId: string,
  action: OrganizationSettingsAction,
): Promise<OrganizationSettingsAccess> {
  const [membership] = await getDatabase()
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new OrganizationSettingsAccessError(
      "Organization membership is required.",
      404,
    );
  }

  const canWrite = isOrganizationSettingsAdmin(membership.role);
  if (action === "write" && !canWrite) {
    throw new OrganizationSettingsAccessError(
      "Only organization owners and admins can change shared settings.",
      403,
    );
  }

  return { role: membership.role, canWrite, action };
}

export function requireOrganizationSettingsAccess(
  userId: string,
  organizationId: string,
  action: OrganizationSettingsAction = "read",
) {
  return checkOrgSettingsAccess(userId, organizationId, action);
}

export function requireOrganizationSettingsWrite(
  userId: string,
  organizationId: string,
) {
  return requireOrganizationSettingsAccess(userId, organizationId, "write");
}

import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { FeatureKey, PlanId } from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";

export type AdminFeatureAccessData = {
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    planId: PlanId;
  }>;
  plans: Array<{ id: PlanId; name: string }>;
  members: Array<{
    organizationId: string;
    userId: string;
    login: string;
    name: string | null;
    role: string;
  }>;
  organizationOverrides: Array<{
    organizationId: string;
    feature: FeatureKey;
    enabled: boolean;
    expiresAt: string | null;
  }>;
  userOverrides: Array<{
    organizationId: string;
    userId: string;
    feature: FeatureKey;
    enabled: boolean;
    expiresAt: string | null;
  }>;
  auditEvents: Array<{
    id: string;
    organizationName: string;
    targetUserLogin: string | null;
    actorLogin: string | null;
    feature: FeatureKey;
    action: "created" | "updated" | "deleted";
    previousEnabled: boolean | null;
    enabled: boolean | null;
    previousExpiresAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
};

export async function getAdminFeatureAccessData(): Promise<AdminFeatureAccessData> {
  const db = getDatabase();
  const [
    organizationRows,
    planRows,
    memberRows,
    organizationOverrideRows,
    userOverrideRows,
    auditRows,
    userRows,
  ] = await Promise.all([
    db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        planId: schema.organizationSubscriptions.planId,
      })
      .from(schema.organizations)
      .innerJoin(
        schema.organizationSubscriptions,
        eq(
          schema.organizationSubscriptions.organizationId,
          schema.organizations.id,
        ),
      )
      .orderBy(schema.organizations.name),
    db
      .select({ id: schema.plans.id, name: schema.plans.name })
      .from(schema.plans)
      .where(eq(schema.plans.active, true))
      .orderBy(schema.plans.name),
    db
      .select({
        organizationId: schema.organizationMembers.organizationId,
        userId: schema.organizationMembers.userId,
        login: schema.users.login,
        name: schema.users.name,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizationMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.organizationMembers.userId),
      )
      .orderBy(schema.users.login),
    db.select().from(schema.organizationFeatureOverrides),
    db.select().from(schema.userFeatureOverrides),
    db
      .select()
      .from(schema.featureOverrideAuditEvents)
      .orderBy(desc(schema.featureOverrideAuditEvents.createdAt))
      .limit(50),
    db
      .select({ id: schema.users.id, login: schema.users.login })
      .from(schema.users),
  ]);

  const organizationsById = new Map(
    organizationRows.map((organization) => [organization.id, organization]),
  );
  const usersById = new Map(userRows.map((user) => [user.id, user.login]));

  return {
    organizations: organizationRows,
    plans: planRows,
    members: memberRows,
    organizationOverrides: organizationOverrideRows.map((override) => ({
      organizationId: override.organizationId,
      feature: override.feature,
      enabled: override.enabled,
      expiresAt: override.expiresAt?.toISOString() ?? null,
    })),
    userOverrides: userOverrideRows.map((override) => ({
      organizationId: override.organizationId,
      userId: override.userId,
      feature: override.feature,
      enabled: override.enabled,
      expiresAt: override.expiresAt?.toISOString() ?? null,
    })),
    auditEvents: auditRows.map((event) => ({
      id: event.id,
      organizationName:
        (event.organizationId
          ? organizationsById.get(event.organizationId)?.name
          : null) ?? "Deleted organization",
      targetUserLogin: event.targetUserId
        ? (usersById.get(event.targetUserId) ?? "deleted user")
        : null,
      actorLogin: event.actorUserId
        ? (usersById.get(event.actorUserId) ?? "deleted user")
        : null,
      feature: event.feature,
      action: event.action,
      previousEnabled: event.previousEnabled,
      enabled: event.enabled,
      previousExpiresAt: event.previousExpiresAt?.toISOString() ?? null,
      expiresAt: event.expiresAt?.toISOString() ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function assignOrganizationPlan(input: {
  organizationId: string;
  planId: PlanId;
}): Promise<void> {
  const db = getDatabase();
  const [organization, plan] = await Promise.all([
    db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
    db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(
        and(eq(schema.plans.id, input.planId), eq(schema.plans.active, true)),
      )
      .limit(1),
  ]);
  if (!organization[0]) throw new Error("Organization not found.");
  if (!plan[0]) throw new Error("Active plan not found.");

  await db
    .insert(schema.organizationSubscriptions)
    .values({
      organizationId: input.organizationId,
      planId: input.planId,
      status: "active",
    })
    .onConflictDoUpdate({
      target: schema.organizationSubscriptions.organizationId,
      set: {
        planId: input.planId,
        status: "active",
        updatedAt: new Date(),
      },
    });
}

type OverrideState = "inherit" | "enabled" | "disabled";

export async function setOrganizationFeatureOverride(input: {
  organizationId: string;
  feature: FeatureKey;
  state: OverrideState;
  expiresAt: Date | null;
  actorUserId: string;
}): Promise<void> {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1);
    if (!organization) throw new Error("Organization not found.");

    const where = and(
      eq(
        schema.organizationFeatureOverrides.organizationId,
        input.organizationId,
      ),
      eq(schema.organizationFeatureOverrides.feature, input.feature),
    );
    const [previous] = await transaction
      .select()
      .from(schema.organizationFeatureOverrides)
      .where(where)
      .limit(1);

    if (input.state === "inherit") {
      if (!previous) return;
      await transaction
        .delete(schema.organizationFeatureOverrides)
        .where(where);
    } else {
      const enabled = input.state === "enabled";
      await transaction
        .insert(schema.organizationFeatureOverrides)
        .values({
          organizationId: input.organizationId,
          feature: input.feature,
          enabled,
          expiresAt: input.expiresAt,
          createdBy: input.actorUserId,
        })
        .onConflictDoUpdate({
          target: [
            schema.organizationFeatureOverrides.organizationId,
            schema.organizationFeatureOverrides.feature,
          ],
          set: {
            enabled,
            expiresAt: input.expiresAt,
            createdBy: input.actorUserId,
            updatedAt: new Date(),
          },
        });
    }

    await transaction.insert(schema.featureOverrideAuditEvents).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      feature: input.feature,
      action:
        input.state === "inherit"
          ? "deleted"
          : previous
            ? "updated"
            : "created",
      previousEnabled: previous?.enabled ?? null,
      enabled: input.state === "inherit" ? null : input.state === "enabled",
      previousExpiresAt: previous?.expiresAt ?? null,
      expiresAt: input.state === "inherit" ? null : input.expiresAt,
    });
  });
}

export async function setUserFeatureOverride(input: {
  organizationId: string;
  userId: string;
  feature: FeatureKey;
  state: OverrideState;
  expiresAt: Date | null;
  actorUserId: string;
}): Promise<void> {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [member] = await transaction
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, input.organizationId),
          eq(schema.organizationMembers.userId, input.userId),
        ),
      )
      .limit(1);
    if (!member) throw new Error("User is not a member of that organization.");

    const where = and(
      eq(schema.userFeatureOverrides.organizationId, input.organizationId),
      eq(schema.userFeatureOverrides.userId, input.userId),
      eq(schema.userFeatureOverrides.feature, input.feature),
    );
    const [previous] = await transaction
      .select()
      .from(schema.userFeatureOverrides)
      .where(where)
      .limit(1);

    if (input.state === "inherit") {
      if (!previous) return;
      await transaction.delete(schema.userFeatureOverrides).where(where);
    } else {
      const enabled = input.state === "enabled";
      await transaction
        .insert(schema.userFeatureOverrides)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          feature: input.feature,
          enabled,
          expiresAt: input.expiresAt,
          createdBy: input.actorUserId,
        })
        .onConflictDoUpdate({
          target: [
            schema.userFeatureOverrides.organizationId,
            schema.userFeatureOverrides.userId,
            schema.userFeatureOverrides.feature,
          ],
          set: {
            enabled,
            expiresAt: input.expiresAt,
            createdBy: input.actorUserId,
            updatedAt: new Date(),
          },
        });
    }

    await transaction.insert(schema.featureOverrideAuditEvents).values({
      organizationId: input.organizationId,
      targetUserId: input.userId,
      actorUserId: input.actorUserId,
      feature: input.feature,
      action:
        input.state === "inherit"
          ? "deleted"
          : previous
            ? "updated"
            : "created",
      previousEnabled: previous?.enabled ?? null,
      enabled: input.state === "inherit" ? null : input.state === "enabled",
      previousExpiresAt: previous?.expiresAt ?? null,
      expiresAt: input.state === "inherit" ? null : input.expiresAt,
    });
  });
}

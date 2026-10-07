import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { OrganizationRole, PlanId } from "@codev/contracts";
import { schema } from "@codev/db";

import { getStripe } from "../billing/stripe";
import { syncStripeSubscription } from "../billing/subscriptions";
import { getDatabase } from "../platform/database";

export type AdminAccountAccessData = Array<{
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  planId: PlanId;
  subscriptionStatus: typeof schema.organizationSubscriptions.$inferSelect.status;
  provider: string | null;
  currentPeriodEnd: Date | null;
}>;

export async function getAdminAccountAccessData(): Promise<AdminAccountAccessData> {
  const rows = await getDatabase()
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      email: schema.users.email,
      isAdmin: schema.users.isAdmin,
      planId: schema.organizationSubscriptions.planId,
      subscriptionStatus: schema.organizationSubscriptions.status,
      provider: schema.organizationSubscriptions.provider,
      currentPeriodEnd: schema.organizationSubscriptions.currentPeriodEnd,
    })
    .from(schema.users)
    .leftJoin(
      schema.organizationSubscriptions,
      eq(schema.organizationSubscriptions.organizationId, schema.users.id),
    )
    .orderBy(schema.users.login);
  return rows.map((row) => ({
    ...row,
    planId: row.planId ?? "free",
    subscriptionStatus: row.subscriptionStatus ?? "canceled",
  }));
}

export async function setOrganizationMemberRole(input: {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}) {
  const result = await getDatabase()
    .update(schema.organizationMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(schema.organizationMembers.organizationId, input.organizationId),
        eq(schema.organizationMembers.userId, input.userId),
      ),
    )
    .returning({ userId: schema.organizationMembers.userId });
  if (!result[0]) throw new Error("User is not a member of that organization.");
}

export async function setApplicationAdmin(input: {
  userId: string;
  isAdmin: boolean;
  actorUserId: string;
}) {
  if (input.userId === input.actorUserId && !input.isAdmin) {
    throw new Error("You cannot remove your own administrator access.");
  }
  const db = getDatabase();
  if (!input.isAdmin) {
    const [adminCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(eq(schema.users.isAdmin, true));
    if ((adminCount?.count ?? 0) < 2)
      throw new Error("At least one application administrator is required.");
  }
  const result = await db
    .update(schema.users)
    .set({ isAdmin: input.isAdmin, updatedAt: new Date() })
    .where(eq(schema.users.id, input.userId))
    .returning({ id: schema.users.id });
  if (!result[0]) throw new Error("Account not found.");
}

export async function setAccountSubscription(input: {
  userId: string;
  action: "grant" | "revoke";
}) {
  const db = getDatabase();
  const [[account], [subscription]] = await Promise.all([
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1),
    db
      .select()
      .from(schema.organizationSubscriptions)
      .where(eq(schema.organizationSubscriptions.organizationId, input.userId))
      .limit(1),
  ]);
  if (!account) throw new Error("Account not found.");

  const hasLiveStripe =
    subscription?.provider === "stripe" &&
    (subscription.status === "active" || subscription.status === "trialing");
  if (input.action === "grant" && hasLiveStripe) {
    throw new Error(
      "Cancel the live Stripe subscription before granting complimentary access.",
    );
  }
  if (
    input.action === "revoke" &&
    hasLiveStripe &&
    subscription?.providerSubscriptionId
  ) {
    const canceled = await getStripe().subscriptions.cancel(
      subscription.providerSubscriptionId,
    );
    const synced = await syncStripeSubscription(canceled);
    if (!synced.synced)
      throw new Error(
        "Stripe canceled the subscription but CoDev could not sync the account.",
      );
    return;
  }

  const values =
    input.action === "grant"
      ? {
          planId: "pro" as const,
          status: "active" as const,
          provider: "admin",
          providerSubscriptionId: null,
          currentPeriodEnd: null,
          canceledAt: null,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        }
      : {
          planId: "free" as const,
          status: "canceled" as const,
          provider: null,
          providerSubscriptionId: null,
          currentPeriodEnd: null,
          canceledAt: new Date(),
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        };
  await db
    .insert(schema.organizationSubscriptions)
    .values({ organizationId: input.userId, ...values })
    .onConflictDoUpdate({
      target: schema.organizationSubscriptions.organizationId,
      set: values,
    });
}

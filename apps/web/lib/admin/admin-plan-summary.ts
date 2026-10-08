import "server-only";

import { resolveBillingAccess } from "../billing/access";
import { GEN2_FREE_LIFETIME_COMPUTE_LIMIT_MS } from "../billing/config";
import { BILLING_PLANS } from "../billing/plans";
import type { AdminAccountAccessData } from "./admin-account-access";

// Azure USD retail snapshot, 2026-10-07: westus2 Linux Standard_D2ps_v6
// (non-Spot) and E2 LRS Disk, matching the ARM provider's 16 GiB saved disk.
// Source: https://prices.azure.com/api/retail/prices
const VM_USD_PER_HOUR = 0.0702;
const SAVED_DISK_USD_PER_MONTH = 0.6;

export type AdminPlanSummaryRow = {
  id: string;
  name: string;
  accounts: number;
  subscribers: number;
  trials: number;
  grants: number;
  computeHours: number;
  savedDisks: number;
  costPerAccountUsd: number;
  totalCostUsd: number;
};

export function buildAdminPlanSummary(
  accounts: AdminAccountAccessData,
  now = new Date(),
): AdminPlanSummaryRow[] {
  const eligible = effectiveAccounts(accounts, now);
  return BILLING_PLANS.map((plan) => {
    const members = eligible.filter(
      (account) => account.effectivePlan === plan.id,
    );
    const computeHours =
      plan.monthlyComputeHours ??
      GEN2_FREE_LIFETIME_COMPUTE_LIMIT_MS / 3_600_000;
    const costPerAccountUsd =
      computeHours * VM_USD_PER_HOUR +
      plan.workspaceLimit * SAVED_DISK_USD_PER_MONTH;
    return {
      id: plan.id,
      name: plan.name,
      accounts: members.length,
      subscribers: members.filter(
        (account) =>
          account.source === "subscription" &&
          account.subscriptionStatus === "active",
      ).length,
      trials: members.filter(
        (account) =>
          account.source === "subscription" &&
          account.subscriptionStatus === "trialing",
      ).length,
      grants: members.filter((account) => account.source === "admin_grant")
        .length,
      computeHours,
      savedDisks: plan.workspaceLimit,
      costPerAccountUsd,
      totalCostUsd:
        costPerAccountUsd *
        members.filter((account) => !account.isAdmin).length,
    };
  });
}

function effectiveAccounts(accounts: AdminAccountAccessData, now: Date) {
  return accounts.map((account) => {
    const access = resolveBillingAccess({
      isAdmin: false,
      row: { ...account, status: account.subscriptionStatus },
      now,
    });
    return {
      ...account,
      source: access.source,
      effectivePlan: access.hasAccess ? account.planId : "free",
    };
  });
}

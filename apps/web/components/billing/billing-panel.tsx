import { Check } from "lucide-react";

import type { BillingStatus, Gen2OwnerComputeSummary } from "@codev/contracts";

import { BillingButton } from "@/components/billing/billing-button";
import { INDIVIDUAL_FEATURES } from "@/components/billing/plan";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

const FREE_ARM_FEATURES = [
  "Up to 2 persistent ARM64 cloud workspaces (1 active at a time)",
  "50 hours/month compute with 1 workspace, or 35 hours/month shared with 2 workspaces",
  "ARM64 Linux virtual machines with 50 GB persistent storage",
  "Invite collaborators. They join your workspace at no cost",
] as const;

function planSummary(
  status: BillingStatus,
  computeSummary?: Gen2OwnerComputeSummary | null,
) {
  if (status.accessSource === "admin" || computeSummary?.unlimited) {
    return "Administrator accounts are exempt from billing and have unlimited compute.";
  }
  if (status.accessSource === "admin_grant") {
    return "Included with your account. Nothing to pay.";
  }
  if (!status.hasAccess) {
    if (status.status === "past_due") {
      return "Your last payment did not go through. Update your payment method to restore access.";
    }
    if (status.status === "canceled") {
      return "Your subscription has ended. Subscribe again to keep using workspaces.";
    }
    if (computeSummary?.tier === "free" && computeSummary.freeEnabled) {
      const hours = computeSummary.ownedWorkspaceCount >= 2 ? 35 : 50;
      return `Free ARM plan active. Includes ${hours} hours/month (${computeSummary.ownedWorkspaceCount >= 2 ? "shared across 2 workspaces" : "for 1 workspace"}). Resets on ${formatDate(computeSummary.resetsAt)}.`;
    }
    return "Subscribe to create workspaces and run agents. Free ARM workspaces are currently in gated preview for select accounts. You can still sign in and join shared workspaces.";
  }
  if (status.cancelAtPeriodEnd && status.currentPeriodEnd) {
    return `Your plan ends on ${formatDate(status.currentPeriodEnd)}. You keep full access until then.`;
  }
  if (status.status === "trialing" && status.currentPeriodEnd) {
    return `Your trial ends on ${formatDate(status.currentPeriodEnd)}.`;
  }
  if (status.currentPeriodEnd) {
    return `Renews on ${formatDate(status.currentPeriodEnd)}. 1,000 monthly compute minutes included.`;
  }
  return "Your plan is active.";
}

function statusBadge(
  status: BillingStatus,
  computeSummary?: Gen2OwnerComputeSummary | null,
) {
  if (status.accessSource === "admin" || computeSummary?.unlimited) return "Admin";
  if (status.accessSource === "admin_grant") return "Included";
  if (status.hasAccess) {
    return status.cancelAtPeriodEnd ? "Ending" : "Active";
  }
  if (status.status === "past_due") return "Payment failed";
  if (computeSummary?.tier === "free" && computeSummary.freeEnabled) {
    return "Active";
  }
  return "Not subscribed";
}

/** The plan card on the Billing settings page. */
export function BillingPanel({
  status,
  computeSummary,
}: {
  status: BillingStatus;
  computeSummary?: Gen2OwnerComputeSummary | null;
}) {
  const isFreeEligible =
    !status.hasAccess &&
    computeSummary?.tier === "free" &&
    computeSummary.freeEnabled;
  const canSubscribe = !status.hasAccess || status.accessSource === "admin";
  const showPaidPlan = status.accessSource !== "admin_grant";
  const planTitle = isFreeEligible ? "Free Tier (ARM)" : "Individual";
  const features = isFreeEligible ? FREE_ARM_FEATURES : INDIVIDUAL_FEATURES;

  return (
    <Card className="space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{planTitle}</h3>
            <Badge
              variant={
                (status.hasAccess && status.accessSource !== "admin") ||
                isFreeEligible
                  ? "default"
                  : "outline"
              }
            >
              {statusBadge(status, computeSummary)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {planSummary(status, computeSummary)}
          </p>
        </div>
        {showPaidPlan ? (
          <p className="text-right">
            <span className="text-3xl font-semibold tracking-tight">
              {isFreeEligible ? "$0" : `$${status.priceUsdPerMonth}`}
            </span>
            <span className="text-sm text-muted-foreground">
              {isFreeEligible ? " / free preview" : " / month"}
            </span>
          </p>
        ) : null}
      </div>

      <ul className="space-y-2 border-t border-border/60 pt-5 text-sm">
        {features.map((line) => (
          <li className="flex items-start gap-2" key={line}>
            <Check
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-emerald-500"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {showPaidPlan ? (
        <div className="flex flex-wrap items-start gap-3 border-t border-border/60 pt-5">
          {canSubscribe ? (
            <BillingButton action="checkout" size="lg" variant="solid">
              {isFreeEligible
                ? `Upgrade to Individual ($${status.priceUsdPerMonth}/month)`
                : status.status === "canceled"
                  ? "Subscribe again"
                  : `Subscribe for $${status.priceUsdPerMonth}/month`}
            </BillingButton>
          ) : null}
          {status.hasStripeCustomer ? (
            <BillingButton
              action="portal"
              size="lg"
              variant={
                canSubscribe && status.status !== "past_due"
                  ? "outline"
                  : "default"
              }
            >
              {status.status === "past_due"
                ? "Update payment method"
                : "Manage billing"}
            </BillingButton>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

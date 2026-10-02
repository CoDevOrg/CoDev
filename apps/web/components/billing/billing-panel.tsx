import { Check } from "lucide-react";

import type { BillingStatus } from "@codev/contracts";

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

function planSummary(status: BillingStatus) {
  if (status.accessSource === "admin") {
    return "Administrator accounts are exempt from billing.";
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
    return "Subscribe to create workspaces and run agents. You can still sign in and read your settings.";
  }
  if (status.cancelAtPeriodEnd && status.currentPeriodEnd) {
    return `Your plan ends on ${formatDate(status.currentPeriodEnd)}. You keep full access until then.`;
  }
  if (status.status === "trialing" && status.currentPeriodEnd) {
    return `Your trial ends on ${formatDate(status.currentPeriodEnd)}.`;
  }
  if (status.currentPeriodEnd) {
    return `Renews on ${formatDate(status.currentPeriodEnd)}.`;
  }
  return "Your plan is active.";
}

function statusBadge(status: BillingStatus) {
  if (status.accessSource === "admin") return "Admin";
  if (status.accessSource === "admin_grant") return "Included";
  if (status.hasAccess) {
    return status.cancelAtPeriodEnd ? "Ending" : "Active";
  }
  if (status.status === "past_due") return "Payment failed";
  return "Not subscribed";
}

/** The plan card on the Billing settings page. */
export function BillingPanel({ status }: { status: BillingStatus }) {
  const canSubscribe = !status.hasAccess || status.accessSource === "admin";
  const showPaidPlan = status.accessSource !== "admin_grant";
  return (
    <Card className="space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Individual</h3>
            <Badge
              variant={
                status.hasAccess && status.accessSource !== "admin"
                  ? "default"
                  : "outline"
              }
            >
              {statusBadge(status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{planSummary(status)}</p>
        </div>
        {showPaidPlan ? (
          <p className="text-right">
            <span className="text-3xl font-semibold tracking-tight">
              ${status.priceUsdPerMonth}
            </span>
            <span className="text-sm text-muted-foreground"> / month</span>
          </p>
        ) : null}
      </div>

      <ul className="space-y-2 border-t border-border/60 pt-5 text-sm">
        {INDIVIDUAL_FEATURES.map((line) => (
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
              {status.status === "canceled"
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

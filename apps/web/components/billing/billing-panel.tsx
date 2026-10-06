import { Check } from "lucide-react";

import type { BillingStatus, Gen2OwnerComputeSummary } from "@codev/contracts";

import { BillingButton } from "@/components/billing/billing-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FREE_PLAN,
  getBillingPlan,
  SELF_SERVE_PLANS,
} from "@/lib/billing/plans";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

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
      return "Your subscription ended. Choose a plan to reconnect your saved workspace.";
    }
    if (computeSummary?.freeEnabled) {
      const remaining = Math.max(
        0,
        (computeSummary.minutesLimit ?? 0) - computeSummary.minutesUsed,
      );
      return `${Math.floor(remaining / 60)} hours ${remaining % 60} minutes remain in your lifetime free trial.`;
    }
    return "Choose a paid plan to create and run hosted workspaces. Invited collaborators do not need a plan.";
  }
  if (status.cancelAtPeriodEnd && status.currentPeriodEnd) {
    return `Your plan ends on ${formatDate(status.currentPeriodEnd)}. You keep full access until then.`;
  }
  if (status.status === "trialing" && status.currentPeriodEnd) {
    return `Your trial ends on ${formatDate(status.currentPeriodEnd)}.`;
  }
  if (status.currentPeriodEnd) {
    return `Renews on ${formatDate(status.currentPeriodEnd)}. ${status.monthlyComputeHours} workspace hours are included each month.`;
  }
  return "Your plan is active.";
}

function statusBadge(
  status: BillingStatus,
  computeSummary?: Gen2OwnerComputeSummary | null,
) {
  if (status.accessSource === "admin" || computeSummary?.unlimited)
    return "Admin";
  if (status.accessSource === "admin_grant") return "Included";
  if (status.hasAccess) return status.cancelAtPeriodEnd ? "Ending" : "Active";
  if (status.status === "past_due") return "Payment failed";
  if (computeSummary?.freeEnabled) return "Active";
  return "Unavailable";
}

/** Current plan and purchase controls on the Billing settings page. */
export function BillingPanel({
  status,
  computeSummary,
}: {
  status: BillingStatus;
  computeSummary?: Gen2OwnerComputeSummary | null;
}) {
  const currentPlan = status.hasAccess
    ? getBillingPlan(status.planId)
    : FREE_PLAN;
  const canCheckout = !status.hasAccess && status.status !== "past_due";

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 p-6">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{currentPlan.name}</CardTitle>
              <Badge variant={status.hasAccess ? "default" : "outline"}>
                {statusBadge(status, computeSummary)}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {planSummary(status, computeSummary)}
            </p>
          </div>
          <p className="shrink-0 text-right">
            <span className="text-3xl font-semibold tracking-tight">
              ${currentPlan.priceUsdPerMonth}
            </span>
            <span className="text-sm text-muted-foreground">
              {currentPlan.priceUsdPerMonth === 0 ? " free trial" : " / month"}
            </span>
          </p>
        </CardHeader>

        <CardContent className="border-t border-border/60 px-6 py-5">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {currentPlan.features.map((feature) => (
              <li className="flex items-start gap-2" key={feature}>
                <Check
                  aria-hidden
                  className="mt-0.5 text-primary"
                  data-icon="inline-start"
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>

        {status.hasStripeCustomer ? (
          <CardFooter className="border-t border-border/60 p-6">
            <BillingButton action="portal" size="lg" variant="outline">
              {status.status === "past_due"
                ? "Update payment method"
                : "Manage or change plan"}
            </BillingButton>
          </CardFooter>
        ) : null}
      </Card>

      {canCheckout ? (
        <section aria-labelledby="choose-plan-heading" className="grid gap-4">
          <div>
            <h3 className="text-lg font-semibold" id="choose-plan-heading">
              Choose a plan
            </h3>
            <p className="text-sm text-muted-foreground">
              Monthly hours are shared across your workspaces. AI model usage is
              billed separately by your connected provider.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {SELF_SERVE_PLANS.map((plan) => (
              <Card className="flex flex-col" key={plan.id}>
                <CardHeader className="p-5">
                  <CardTitle className="flex items-baseline justify-between gap-3">
                    <span>{plan.name}</span>
                    <span className="text-xl tabular-nums">
                      ${plan.priceUsdPerMonth}/mo
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 px-5 pb-5 text-sm text-muted-foreground">
                  {plan.monthlyComputeHours} hours · {plan.workspaceLimit}{" "}
                  workspace{plan.workspaceLimit === 1 ? "" : "s"} ·{" "}
                  {plan.activeWorkspaceLimit} active
                </CardContent>
                <CardFooter className="border-t border-border/60 p-5">
                  <BillingButton
                    action="checkout"
                    className="w-full"
                    fullWidth
                    planId={plan.id}
                    variant={plan.id === "power" ? "solid" : "outline"}
                  >
                    Choose {plan.name}
                  </BillingButton>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

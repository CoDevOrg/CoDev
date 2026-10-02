import { BillingPanel } from "@/components/billing/billing-panel";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { requireUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/access";
import { syncCheckoutSession } from "@/lib/billing/checkout";
import { logEvent } from "@/lib/platform/observability";

export const metadata = { title: "Billing" };

export default async function PersonalBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const user = await requireUser("/settings/personal/billing");
  const params = await searchParams;

  // Coming back from Checkout: sync the finished session now so access is
  // immediate even if the webhook has not arrived yet. Failure is harmless;
  // the webhook is the durable path.
  if (params.checkout === "success" && params.session_id) {
    try {
      await syncCheckoutSession(user.id, params.session_id);
    } catch (error) {
      logEvent("warn", "billing.checkout.sync_failed", {
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const status = await getBillingStatus(user.id);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="Your CoDev plan. Payments and invoices are handled securely by Stripe."
        title="Billing"
      />

      {params.checkout === "success" ? (
        status.hasAccess ? (
          <p
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm"
            role="status"
          >
            You&apos;re subscribed. Thanks! You can create workspaces now.
          </p>
        ) : (
          <p
            className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
            role="status"
          >
            Payment received. We&apos;re confirming your subscription, so
            refresh this page in a moment.
          </p>
        )
      ) : null}
      {params.checkout === "canceled" ? (
        <p
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
          role="status"
        >
          Checkout canceled. You haven&apos;t been charged.
        </p>
      ) : null}
      {status.status === "past_due" ? (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm"
          role="alert"
        >
          Your last payment failed, so workspaces are paused. Update your
          payment method to continue.
        </p>
      ) : null}

      <BillingPanel status={status} />
    </SettingsPageShell>
  );
}

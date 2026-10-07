import { AdminPlanCard } from "./admin-plan-card";
import type { AdminPlanSummaryRow } from "@/lib/admin/admin-plan-summary";

export function AdminPlanSummary({ plans }: { plans: AdminPlanSummaryRow[] }) {
  return (
    <section aria-labelledby="plan-cost-heading" className="space-y-4">
      <div>
        <h2 id="plan-cost-heading" className="text-lg font-semibold">
          Plans & estimated infrastructure cost
        </h2>
        <p className="text-sm text-muted-foreground">
          Full compute allowance and one month of saved disks per account.
          Estimates, not actual spend.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {plans.map((plan) => (
          <AdminPlanCard key={plan.id} plan={plan} />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Azure retail snapshot: Oct 7, 2026 · West US 2 · Linux D2ps v6 at
        $0.0702/hour + 16 GiB saved SSD at $0.60/month. Excludes OS disks, IP
        addresses, disk operations, network, shared services, taxes and
        discounts; AI subscriptions are supplied by users. Assumes full
        allowances and saved workspace capacity, including granted access. Admin
        accounts are excluded; expired subscriptions count as Free. Active
        subscribers are active Stripe subscriptions; trials and grants are shown
        separately. Enterprise uses catalog base limits.{" "}
        <a
          href="https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Rate source
        </a>
        .
      </p>
    </section>
  );
}

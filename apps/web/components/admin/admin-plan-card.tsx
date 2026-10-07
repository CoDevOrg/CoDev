import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AdminPlanSummaryRow } from "@/lib/admin/admin-plan-summary";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );

export function AdminPlanCard({ plan }: { plan: AdminPlanSummaryRow }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="p-4">
        <CardTitle>{plan.name}</CardTitle>
        <CardDescription>
          {plan.id === "free"
            ? "Lifetime compute + 1 month storage"
            : "Monthly allowance estimate"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 px-4 pb-4">
        <PlanCounts plan={plan} />
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {money(plan.costPerAccountUsd)}
          </p>
          <p className="text-xs text-muted-foreground">
            per account · {plan.computeHours}h + {plan.savedDisks} saved disk
            {plan.savedDisks === 1 ? "" : "s"}
          </p>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2 px-4 pb-4 text-sm">
        <span>Plan total estimate</span>
        <strong className="tabular-nums">{money(plan.totalCostUsd)}</strong>
      </CardFooter>
    </Card>
  );
}

function PlanCounts({ plan }: { plan: AdminPlanSummaryRow }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-2">
        <dt>Accounts on plan</dt>
        <dd className="font-semibold">{plan.accounts}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt>Active subscribers</dt>
        <dd className="font-semibold">{plan.subscribers}</dd>
      </div>
      <div className="flex justify-between gap-2 text-muted-foreground">
        <dt>Trials / grants</dt>
        <dd>
          {plan.trials} / {plan.grants}
        </dd>
      </div>
    </dl>
  );
}

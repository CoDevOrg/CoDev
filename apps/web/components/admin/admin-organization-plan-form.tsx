"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CreditCard } from "lucide-react";

import { updateOrganizationPlan } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import type { AdminFeatureActionResult } from "@/app/admin/actions";
import { AdminNotice } from "./admin-notice";

export function AdminOrganizationPlanForm({
  data,
}: {
  data: AdminFeatureAccessData;
}) {
  const firstOrganization = data.organizations[0]?.id ?? "";
  const [organizationId, setOrganizationId] = useState(firstOrganization);
  const [result, setResult] = useState<AdminFeatureActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedPlan =
    data.organizations.find((item) => item.id === organizationId)?.planId ??
    "free";
  const canAssignPlan = data.plans.length > 0;
  const selectedPlanIsActive = data.plans.some(
    (plan) => plan.id === selectedPlan,
  );
  const currentPlanName =
    data.plans.find((plan) => plan.id === selectedPlan)?.name ??
    `${selectedPlan} (inactive)`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () =>
      setResult(await updateOrganizationPlan(formData)),
    );
  }

  return (
    <Card className="flex flex-col justify-between border-border/80 bg-card/60 backdrop-blur-xs">
      <div>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="size-4 text-primary" />
            Assign Organization Plan
          </CardTitle>
          <CardDescription className="text-xs">
            Sets the baseline plan for feature access. This does not charge
            Stripe.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3 pb-4">
            <FieldGroup className="space-y-3">
              <Field>
                <FieldLabel
                  htmlFor="plan-organization"
                  className="text-xs font-medium"
                >
                  Organization
                </FieldLabel>
                <select
                  id="plan-organization"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                  name="organizationId"
                  value={organizationId}
                  onChange={(event) => setOrganizationId(event.target.value)}
                >
                  {data.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel
                  htmlFor="organization-plan"
                  className="text-xs font-medium"
                >
                  Plan to apply
                </FieldLabel>
                <select
                  id="organization-plan"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                  name="planId"
                  disabled={!canAssignPlan}
                  required
                  key={`${organizationId}:${selectedPlan}`}
                  defaultValue={selectedPlanIsActive ? selectedPlan : ""}
                >
                  <option value="" disabled>
                    Select an active plan
                  </option>
                  {data.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
                <FieldDescription className="text-[11px] text-muted-foreground mt-1">
                  {canAssignPlan
                    ? `Current plan: ${currentPlanName}.`
                    : "No active plans are configured."}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <AdminNotice result={result} />
          </CardContent>
          <CardFooter className="border-t border-border/60 pt-3">
            <Button
              type="submit"
              size="sm"
              disabled={pending || !canAssignPlan}
              className="text-xs"
            >
              {pending ? "Applying…" : "Apply Plan"}
            </Button>
          </CardFooter>
        </form>
      </div>
    </Card>
  );
}

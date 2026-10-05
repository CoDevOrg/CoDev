"use client";

import { useState, useTransition, type FormEvent } from "react";

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
    <Card className="admin-control-card">
      <CardHeader>
        <CardTitle>Assign organization plan</CardTitle>
        <CardDescription>
          Sets the plan used for this organization&apos;s baseline feature
          access. This does not charge Stripe. Cancel live Stripe plans in
          Stripe before changing them here.
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="admin-control-form-content">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="plan-organization">Organization</FieldLabel>
              <select
                id="plan-organization"
                className="admin-control-select"
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
              <FieldLabel htmlFor="organization-plan">Plan to apply</FieldLabel>
              <select
                id="organization-plan"
                className="admin-control-select"
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
              <FieldDescription>
                {canAssignPlan
                  ? `Current plan: ${currentPlanName}.`
                  : "No active plans are configured."}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <AdminNotice result={result} />
        </CardContent>
        <CardFooter className="admin-control-form-footer">
          <Button type="submit" disabled={pending || !canAssignPlan}>
            {pending ? "Applying…" : "Apply plan"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

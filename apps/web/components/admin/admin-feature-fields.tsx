"use client";

import { useState } from "react";
import type { FeatureKey } from "@codev/contracts";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const FEATURE: FeatureKey = "hosted_codex_subscription";
type OverrideState = "inherit" | "enabled" | "disabled";

export function AdminFeatureFields({
  idPrefix,
  scope,
}: {
  idPrefix: string;
  scope: "organization" | "member";
}) {
  const [state, setState] = useState<OverrideState>("inherit");
  const inheritLabel =
    scope === "organization"
      ? "Use plan and default access"
      : "Follow organization policy";
  const inheritDescription =
    scope === "organization"
      ? "Removes this organization rule so the plan or feature default applies."
      : "Removes this member rule so the organization policy applies.";

  return (
    <FieldGroup className="space-y-3">
      <input type="hidden" name="feature" value={FEATURE} />
      <Field>
        <FieldLabel
          htmlFor={`${idPrefix}-state`}
          className="text-xs font-medium"
        >
          Access override
        </FieldLabel>
        <select
          id={`${idPrefix}-state`}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
          name="state"
          value={state}
          onChange={(event) => setState(event.target.value as OverrideState)}
        >
          <option value="inherit">{inheritLabel}</option>
          <option value="enabled">Allow</option>
          <option value="disabled">Block</option>
        </select>
        <FieldDescription className="text-[11px] text-muted-foreground mt-1">
          {inheritDescription}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel
          htmlFor={`${idPrefix}-expires`}
          className="text-xs font-medium"
        >
          Expiry (optional)
        </FieldLabel>
        <Input
          id={`${idPrefix}-expires`}
          name="expiresAt"
          type="datetime-local"
          disabled={state === "inherit"}
          className="h-9 text-xs"
        />
        <FieldDescription className="text-[11px] text-muted-foreground mt-1">
          Leave blank for no expiry. The time is interpreted in your local
          timezone.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

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
    <FieldGroup>
      <input type="hidden" name="feature" value={FEATURE} />
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-state`}>Access override</FieldLabel>
        <select
          id={`${idPrefix}-state`}
          className="admin-control-select"
          name="state"
          value={state}
          onChange={(event) => setState(event.target.value as OverrideState)}
        >
          <option value="inherit">{inheritLabel}</option>
          <option value="enabled">Allow</option>
          <option value="disabled">Block</option>
        </select>
        <FieldDescription>{inheritDescription}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-expires`}>
          Expiry (optional)
        </FieldLabel>
        <Input
          id={`${idPrefix}-expires`}
          name="expiresAt"
          type="datetime-local"
          disabled={state === "inherit"}
        />
        <FieldDescription>
          Leave blank for no expiry. The time is interpreted in your local
          timezone.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";

import { changePasswordAction } from "@/app/actions/password";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { IDLE } from "./action-state";
import { PasswordRequirements } from "./password-requirements";

/** Success redirects to `?password=changed`; only errors come back here. */
export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, IDLE);
  const [password, setPassword] = useState("");

  // React resets the form after every action, so the checklist follows.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPassword("");
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Field className="max-w-sm">
        <FieldLabel htmlFor="current-password">Current password</FieldLabel>
        <Input
          autoComplete="current-password"
          id="current-password"
          name="current"
          required
          type="password"
        />
      </Field>
      <FieldGroup className="sm:flex-row">
        <Field className="flex-1">
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            autoComplete="new-password"
            id="new-password"
            maxLength={128}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
          />
        </Field>
        <Field className="flex-1">
          <FieldLabel htmlFor="confirm-password">
            Confirm new password
          </FieldLabel>
          <Input
            autoComplete="new-password"
            id="confirm-password"
            maxLength={128}
            name="confirm"
            required
            type="password"
          />
        </Field>
      </FieldGroup>
      <PasswordRequirements password={password} />
      <Button className="w-fit" disabled={pending} size="sm" type="submit">
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}

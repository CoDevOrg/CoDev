"use client";

import { useState } from "react";
import { Check, Circle } from "lucide-react";

import { setAccountPassword } from "@/app/actions/set-password";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getNewAccountPasswordRequirements } from "@/lib/auth/password-policy";
import { cn } from "@/lib/platform/utils";

export function SetPasswordForm({ redirectTo }: { redirectTo: string }) {
  const [password, setPassword] = useState("");
  const requirements = getNewAccountPasswordRequirements(password);
  const action = setAccountPassword.bind(null, redirectTo);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FieldGroup className="sm:flex-row">
        <Field className="flex-1">
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            autoComplete="new-password"
            id="new-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>
        <Field className="flex-1">
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <Input
            autoComplete="new-password"
            id="confirm-password"
            name="confirm"
            required
            type="password"
          />
        </Field>
      </FieldGroup>
      <ul
        aria-label="Password requirements"
        className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2"
      >
        {requirements.map((requirement) => (
          <li
            className={cn(
              "flex items-center gap-1.5",
              requirement.met ? "text-foreground" : "text-muted-foreground",
            )}
            key={requirement.id}
          >
            {requirement.met ? (
              <Check aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <Circle aria-hidden className="size-3.5 shrink-0" />
            )}
            {requirement.label}
          </li>
        ))}
      </ul>
      <Button className="w-fit" size="sm" type="submit">
        Set password
      </Button>
    </form>
  );
}

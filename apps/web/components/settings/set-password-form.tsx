"use client";

import { useState } from "react";
import { Check, Circle } from "lucide-react";

import { setAccountPassword } from "@/app/actions/set-password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getNewAccountPasswordRequirements } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

export function SetPasswordForm({ redirectTo }: { redirectTo: string }) {
  const [password, setPassword] = useState("");
  const requirements = getNewAccountPasswordRequirements(password);
  const action = setAccountPassword.bind(null, redirectTo);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-xs">
          <span className="font-medium text-muted-foreground">
            New password
          </span>
          <Input
            autoComplete="new-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label className="block space-y-1.5 text-xs">
          <span className="font-medium text-muted-foreground">
            Confirm password
          </span>
          <Input
            autoComplete="new-password"
            name="confirm"
            required
            type="password"
          />
        </label>
      </div>
      <ul
        aria-label="Password requirements"
        className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2"
      >
        {requirements.map((requirement) => (
          <li
            className={cn(
              "flex items-center gap-1.5",
              requirement.met ? "text-emerald-400" : "text-muted-foreground",
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
      <Button size="sm" type="submit">
        Set password
      </Button>
    </form>
  );
}

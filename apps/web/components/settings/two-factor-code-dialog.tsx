"use client";

import { useActionState, useEffect, useState } from "react";

import type { TwoFactorActionState } from "@/app/actions/two-factor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** A sensitive 2FA change, confirmed with a current code (or a recovery code). */
export function TwoFactorCodeDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  serverAction,
  onResult,
}: {
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  serverAction: (
    state: TwoFactorActionState,
    formData: FormData,
  ) => Promise<TwoFactorActionState>;
  onResult: (state: TwoFactorActionState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(serverAction, {
    status: "idle",
  });

  useEffect(() => {
    if (state.status === "idle" || state.status === "error") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
    onResult(state);
  }, [state, onResult]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <form action={action} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {state.status === "error" ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`code-${trigger}`}>
              Authentication code
            </FieldLabel>
            <Input
              autoComplete="one-time-code"
              autoFocus
              id={`code-${trigger}`}
              maxLength={32}
              name="code"
              placeholder="6-digit code or a recovery code"
              required
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending}
              size="sm"
              type="submit"
              variant={destructive ? "destructive" : "default"}
            >
              {pending ? "Checking…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

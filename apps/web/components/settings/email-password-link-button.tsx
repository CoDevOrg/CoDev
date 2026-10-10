"use client";

import { useActionState, useEffect } from "react";
import { Mail } from "lucide-react";

import { emailPasswordLinkAction } from "@/app/actions/password";
import { Button } from "@/components/ui/button";

import { IDLE } from "./action-state";
import { useSettingsNotify } from "./settings-feedback";

/** Sends a signed, one-hour link to the account's email to set or reset its password. */
export function EmailPasswordLinkButton({
  label,
  variant = "outline",
}: {
  label: string;
  variant?: "outline" | "default" | "ghost";
}) {
  const [state, action, pending] = useActionState(
    emailPasswordLinkAction,
    IDLE,
  );
  const notify = useSettingsNotify();

  useEffect(() => {
    if (state.status !== "idle")
      notify?.(state.message, state.status === "success" ? "success" : "error");
  }, [state, notify]);

  return (
    <form action={action} className="flex flex-col gap-2">
      <Button
        className="w-fit"
        disabled={pending}
        size="sm"
        type="submit"
        variant={variant}
      >
        <Mail aria-hidden data-icon="inline-start" />
        {pending ? "Sending…" : label}
      </Button>
      {state.status !== "idle" && !notify ? (
        <p className="m-0 text-sm text-muted-foreground" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import type { ActionState } from "./action-state";
import { useSettingsNotify } from "./settings-feedback";

/** Runs one session-management action and reports it as a toast. */
export function SessionActionButton({
  label,
  pendingLabel,
  run,
  variant = "outline",
}: {
  label: string;
  pendingLabel: string;
  run: () => Promise<ActionState>;
  variant?: "outline" | "ghost" | "destructive";
}) {
  const [pending, startTransition] = useTransition();
  const notify = useSettingsNotify();
  const router = useRouter();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          if (result.status === "idle") return;
          notify?.(
            result.message,
            result.status === "success" ? "success" : "error",
          );
          router.refresh();
        })
      }
      size="sm"
      type="button"
      variant={variant}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

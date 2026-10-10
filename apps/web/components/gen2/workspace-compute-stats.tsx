"use client";

import type { Gen2OwnerComputeSummary } from "@codev/contracts";

function formatUtcReset(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return (
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }) + " UTC"
    );
  } catch {
    return "Next month";
  }
}

export function WorkspaceComputeAlerts({
  computeSummary,
}: {
  computeSummary?: Gen2OwnerComputeSummary | null;
}) {
  if (!computeSummary) return null;

  const limit = computeSummary.minutesLimit;
  const used = computeSummary.minutesUsed;
  const isExhausted =
    !computeSummary.unlimited && limit !== null && used >= limit;
  const isBudgetBlocked = computeSummary.budget?.blocked === true;

  if (isExhausted) {
    return (
      <div
        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        role="alert"
      >
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          {computeSummary.resetsAt
            ? "Monthly workspace time used"
            : "Free trial time used"}
        </p>
        <p className="mt-1 text-muted-foreground">
          You have used all {Math.floor(limit / 60)} included hours. Your
          workspace and saved files remain safe on persistent storage.{" "}
          {computeSummary.resetsAt
            ? `Compute will resume at the next UTC reset on ${formatUtcReset(computeSummary.resetsAt)}.`
            : "Choose a paid plan to reconnect."}
        </p>
      </div>
    );
  }

  if (isBudgetBlocked) {
    return (
      <div
        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        role="alert"
      >
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          Free compute paused by budget guard
        </p>
        <p className="mt-1 text-muted-foreground">
          Free workspace compute is paused by the monthly resource budget guard.
          All saved files and workspace data remain safe.
        </p>
      </div>
    );
  }

  return null;
}

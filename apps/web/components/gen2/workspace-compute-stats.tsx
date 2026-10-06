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

export function WorkspaceComputeStatsCards({
  computeSummary,
  ownedCount,
}: {
  computeSummary?: Gen2OwnerComputeSummary | null;
  ownedCount: number;
}) {
  if (!computeSummary) {
    return (
      <div className="gen2-stat-card">
        <span className="gen2-stat-value">{ownedCount}</span>
        <span className="gen2-stat-label">Owned workspaces</span>
      </div>
    );
  }

  const effectiveOwned = computeSummary.ownedWorkspaceCount ?? ownedCount;
  const isUnlimited = computeSummary.unlimited;
  const limit = computeSummary.minutesLimit;
  const used = computeSummary.minutesUsed;

  const usedHours = Math.floor(used / 60);
  const remainingMinutes = limit !== null ? Math.max(0, limit - used) : null;
  const remainingHours =
    remainingMinutes !== null ? Math.floor(remainingMinutes / 60) : null;

  return (
    <>
      <div className="gen2-stat-card">
        <span className="gen2-stat-value">
          {effectiveOwned} of {computeSummary.workspaceLimit}
        </span>
        <span className="gen2-stat-label">Owned workspaces</span>
      </div>

      <div className="gen2-stat-card">
        <span className="gen2-stat-value">
          {isUnlimited
            ? "Unlimited"
            : limit !== null
              ? `${remainingHours}h left`
              : `${usedHours}h`}
        </span>
        <span className="gen2-stat-label">
          {isUnlimited
            ? "Monthly compute"
            : limit !== null
              ? `${usedHours}h used of ${Math.floor(limit / 60)}h`
              : "Compute time"}
        </span>
      </div>

      <div className="gen2-stat-card">
        <span className="gen2-stat-value is-handle">
          {computeSummary.resetsAt
            ? formatUtcReset(computeSummary.resetsAt)
            : "No reset"}
        </span>
        <span className="gen2-stat-label">
          {computeSummary.resetsAt ? "Monthly reset" : "Trial usage"}
        </span>
      </div>
    </>
  );
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

import type { Gen2Workspace } from "@codev/contracts";

/** What a member sees a workspace doing, from its lifecycle and VM state. */
export type WorkspacePhase =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "failed"
  | "deleting";

export const PHASE_LABEL: Record<WorkspacePhase, string> = {
  running: "Running",
  starting: "Starting",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
  deleting: "Deleting",
};

/**
 * A stop is recorded as `provisioning` with a `stopping` runtime, so the
 * lifecycle status alone cannot tell starting from stopping.
 */
export function workspacePhase(workspace: Gen2Workspace): WorkspacePhase {
  const { status, runtimeStatus } = workspace;
  if (status === "deleting") return "deleting";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "stopped") return "stopped";
  if (runtimeStatus === "stopping") return "stopping";
  if (status === "provisioning") return "starting";
  if (workspace.runtimeProvider !== "azure_arm") return "running";
  if (runtimeStatus === "ready") return "running";
  if (runtimeStatus === "failed") return "failed";
  return runtimeStatus === "stopped" ? "stopped" : "starting";
}

/**
 * Changes on its own soon, so the home page polls sooner. An interrupted
 * deletion keeps its error and waits for the owner to retry.
 */
export function isWorkspaceSettling(workspace: Gen2Workspace) {
  const phase = workspacePhase(workspace);
  if (phase === "deleting") return !workspace.lastError;
  return phase === "starting" || phase === "stopping";
}

/** "45m", "3h", "12h 5m": compact enough for a stat tile. */
export function formatMinutes(total: number) {
  const minutes = Math.max(0, Math.floor(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60],
  ["month", 30 * 24 * 60],
  ["week", 7 * 24 * 60],
  ["day", 24 * 60],
  ["hour", 60],
  ["minute", 1],
];

/** "just now", "5 minutes ago", "yesterday". */
export function formatRelativeTime(iso: string, now: number) {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (!Number.isFinite(minutes) || Math.abs(minutes) < 1) return "just now";
  const [unit, size] =
    STEPS.find(([, step]) => Math.abs(minutes) >= step) ?? STEPS[5]!;
  return RELATIVE.format(Math.round(minutes / size), unit);
}

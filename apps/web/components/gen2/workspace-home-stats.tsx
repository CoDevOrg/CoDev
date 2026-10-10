"use client";

import type { ReactNode } from "react";
import { Activity, Boxes, Gauge, Layers } from "lucide-react";
import type { Gen2OwnerComputeSummary, Gen2Workspace } from "@codev/contracts";

import {
  formatMinutes,
  workspacePhase,
} from "@/components/gen2/workspace-phase";

function formatReset(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Stat({
  icon,
  label,
  value,
  detail,
  meter,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  meter?: number | undefined;
  tone?: "warning" | undefined;
}) {
  return (
    <div className="gen2-stat" data-tone={tone}>
      <span className="gen2-stat-label">
        {icon}
        {label}
      </span>
      <span className="gen2-stat-value">{value}</span>
      {meter === undefined ? null : (
        <span className="gen2-stat-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, meter * 100)}%` }} />
        </span>
      )}
      <span className="gen2-stat-detail">{detail}</span>
    </div>
  );
}

function computeStat(compute: Gen2OwnerComputeSummary) {
  const used = compute.minutesUsed;
  const limit = compute.minutesLimit;
  const label = compute.resetsAt ? "Compute this month" : "Trial compute";
  if (compute.unlimited || limit === null) {
    return {
      label,
      value: compute.unlimited ? "Unlimited" : formatMinutes(used),
      detail: `${formatMinutes(used)} used`,
    };
  }
  const reset = compute.resetsAt
    ? ` · resets ${formatReset(compute.resetsAt)}`
    : "";
  return {
    label,
    value: `${formatMinutes(limit - used)} left`,
    detail: `${formatMinutes(used)} of ${formatMinutes(limit)} used${reset}`,
    meter: limit > 0 ? used / limit : 1,
    tone: used >= limit ? ("warning" as const) : undefined,
  };
}

function runningDetail(
  phases: string[],
  activeLimit: number | null,
  running: number,
) {
  const starting = phases.filter((phase) => phase === "starting").length;
  const stopping = phases.filter((phase) => phase === "stopping").length;
  const changing = [
    starting ? `${starting} starting` : "",
    stopping ? `${stopping} stopping` : "",
  ].filter(Boolean);
  if (changing.length) return changing.join(" · ");
  if (activeLimit !== null) return `Up to ${activeLimit} at a time`;
  return running ? "Live now" : "Nothing running";
}

/** The home page's at-a-glance numbers; every value follows the live poll. */
export function WorkspaceHomeStats({
  workspaces,
  compute,
}: {
  workspaces: Gen2Workspace[];
  compute: Gen2OwnerComputeSummary;
}) {
  const phases = workspaces.map(workspacePhase);
  const running = phases.filter((phase) => phase === "running").length;
  const owned = compute.ownedWorkspaceCount;
  const shared = workspaces.filter((item) => item.role !== "owner").length;
  const slots = compute.workspaceLimit;
  const usage = computeStat(compute);

  return (
    <section className="gen2-stats" aria-label="Workspace summary">
      <Stat
        icon={<Boxes aria-hidden="true" />}
        label="Workspaces"
        value={workspaces.length}
        detail={`${owned} owned · ${shared} shared`}
      />
      <Stat
        icon={<Activity aria-hidden="true" />}
        label="Running now"
        value={
          <>
            {running}
            {running ? <span className="gen2-live-dot" /> : null}
          </>
        }
        detail={runningDetail(phases, compute.activeWorkspaceLimit, running)}
      />
      <Stat icon={<Gauge aria-hidden="true" />} {...usage} />
      <Stat
        icon={<Layers aria-hidden="true" />}
        label="Workspace slots"
        value={`${owned} of ${slots}`}
        meter={slots > 0 ? owned / slots : 1}
        tone={owned >= slots ? "warning" : undefined}
        detail={
          owned >= slots ? "Limit reached" : `${slots - owned} more available`
        }
      />
    </section>
  );
}

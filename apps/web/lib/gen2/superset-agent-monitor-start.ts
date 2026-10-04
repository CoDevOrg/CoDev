import "server-only";

import { start } from "workflow/api";

import { gen2SupersetAgentMonitorWorkflow } from "@/workflows/gen2-superset-agent-monitor";

/** Dispatch the durable monitor only after the host has accepted a new run. */
export async function startGen2SupersetAgentMonitor(runId: string) {
  await start(gen2SupersetAgentMonitorWorkflow, [runId]);
}

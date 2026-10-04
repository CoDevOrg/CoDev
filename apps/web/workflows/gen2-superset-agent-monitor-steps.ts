export async function pollGen2SupersetAgentMonitorStep(
  runId: string,
  after: number,
) {
  "use step";
  const { monitorGen2SupersetAgentRun } =
    await import("@/lib/gen2/superset-agent-monitor");
  return monitorGen2SupersetAgentRun({ runId, after });
}

export async function failGen2SupersetAgentMonitorStep(runId: string) {
  "use step";
  const { failGen2SupersetAgentMonitor } =
    await import("@/lib/gen2/superset-agent-monitor");
  await failGen2SupersetAgentMonitor(runId);
}

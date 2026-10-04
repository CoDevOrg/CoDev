import {
  failGen2SupersetAgentMonitorStep,
  pollGen2SupersetAgentMonitorStep,
} from "./gen2-superset-agent-monitor-steps";

/** Keep an agent's credential seat and durable state alive after its browser closes. */
export async function gen2SupersetAgentMonitorWorkflow(runId: string) {
  "use workflow";
  let after = 0;
  try {
    for (;;) {
      const poll = await pollGen2SupersetAgentMonitorStep(runId, after);
      if (poll.exited) return;
      after = poll.nextSequence;
    }
  } catch {
    await failGen2SupersetAgentMonitorStep(runId);
  }
}

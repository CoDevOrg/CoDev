import {
  claimNextAgentTurnStep,
  failAgentSessionStep,
  runAgentTurnStep,
} from "./agent-session-steps";

export async function agentSessionWorkflow(sessionId: string) {
  "use workflow";

  try {
    for (;;) {
      const turnId = await claimNextAgentTurnStep(sessionId);
      if (!turnId) return { sessionId, status: "idle" };
      await runAgentTurnStep(turnId);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Agent workflow failed.";
    await failAgentSessionStep(sessionId, message);
    throw error;
  }
}

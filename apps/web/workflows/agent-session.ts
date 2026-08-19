import {
  claimNextAgentTurnStep,
  failAgentSessionStep,
  runAgentTurnStep,
} from "./agent-session-steps";

/**
 * Errors thrown from a durable "use step" call are serialized for replay and
 * rehydrated as plain objects, not the original Error instance — so a bare
 * `instanceof Error` check here silently collapses every real failure reason
 * into a generic message. Fall back to the deserialized `.message` field.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Agent workflow failed.";
}

export async function agentSessionWorkflow(sessionId: string) {
  "use workflow";

  try {
    for (;;) {
      const turnId = await claimNextAgentTurnStep(sessionId);
      if (!turnId) return { sessionId, status: "idle" };
      await runAgentTurnStep(turnId);
    }
  } catch (error) {
    const message = extractErrorMessage(error);
    await failAgentSessionStep(sessionId, message);
    throw error;
  }
}

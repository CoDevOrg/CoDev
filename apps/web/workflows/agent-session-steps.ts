export async function claimNextAgentTurnStep(sessionId: string) {
  "use step";
  const { claimNextAgentTurn } = await import("@/lib/agent-runtime");
  return claimNextAgentTurn(sessionId);
}

export async function runAgentTurnStep(turnId: string) {
  "use step";
  const { runAgentTurn } = await import("@/lib/agent-runtime");
  return runAgentTurn(turnId);
}

export async function failAgentSessionStep(sessionId: string, message: string) {
  "use step";
  const { failAgentSession } = await import("@/lib/agent-runtime");
  return failAgentSession(sessionId, message);
}

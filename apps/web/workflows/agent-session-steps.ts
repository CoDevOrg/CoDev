export async function claimNextAgentTurnStep(sessionId: string) {
  "use step";
  const { claimNextAgentTurn } = await import("@/lib/agent-runtime");
  return claimNextAgentTurn(sessionId);
}

export async function prepareAgentTurnStep(turnId: string) {
  "use step";
  const { prepareAgentTurn } = await import("@/lib/agent-runtime");
  return prepareAgentTurn(turnId);
}

export async function checkTurnInterruptedStep(turnId: string) {
  "use step";
  const { checkTurnInterrupted } = await import("@/lib/agent-runtime");
  return checkTurnInterrupted(turnId);
}

export async function pollCodexTurnStep(
  workspaceId: string,
  codexSessionId: string,
  after: number,
) {
  "use step";
  const { pollCodexTurn } = await import("@/lib/agent-runtime");
  return pollCodexTurn(workspaceId, codexSessionId, after);
}

export async function finishCodexTurnStep(
  turnId: string,
  credentialId: string,
  poll: { output: string; exitCode: number; codexAuthCacheJson?: string },
) {
  "use step";
  const { finishCodexTurn } = await import("@/lib/agent-runtime");
  return finishCodexTurn(turnId, credentialId, poll);
}

export async function cancelCodexTurnStep(
  workspaceId: string,
  codexSessionId: string,
  credentialId: string,
) {
  "use step";
  const { cancelCodexTurn } = await import("@/lib/agent-runtime");
  return cancelCodexTurn(workspaceId, codexSessionId, credentialId);
}

export async function failAgentSessionStep(sessionId: string, message: string) {
  "use step";
  const { failAgentSession } = await import("@/lib/agent-runtime");
  return failAgentSession(sessionId, message);
}

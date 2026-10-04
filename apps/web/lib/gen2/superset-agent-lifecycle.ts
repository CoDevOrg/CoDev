import "server-only";

import { updateHostedCodexAuthCacheForUser } from "../providers/hosted-codex-subscription-credentials";

export async function captureRefreshedSupersetCredential(
  run: { connectionId: string | null; createdBy: string; provider: string },
  refreshedCodexAuthCache: string | undefined,
) {
  if (
    !refreshedCodexAuthCache ||
    !run.connectionId ||
    run.provider !== "openai"
  ) {
    return;
  }
  await updateHostedCodexAuthCacheForUser({
    credentialId: run.connectionId,
    userId: run.createdBy,
    authCacheJson: refreshedCodexAuthCache,
  });
}

export function supersetAgentExitReason(exitCode: number | null) {
  if (exitCode === 0) return "completed";
  return exitCode === null ? "exit_unknown" : `exit_code:${exitCode}`;
}

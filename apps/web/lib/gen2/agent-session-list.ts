import "server-only";

import { getGen2AgentSession, listGen2AgentSessions } from "./agent-sessions";
import { requireGen2Member } from "./workspaces";

function toSafeSession(
  session: Awaited<ReturnType<typeof getGen2AgentSession>>,
) {
  return {
    id: session.id,
    chatId: session.chatId,
    createdBy: session.createdBy,
    task: session.task,
    worktreeId: session.worktreeId,
    provider: session.provider,
    status: session.status,
    recoveryState: session.recoveryState,
    safeOutput: session.safeOutput,
    finalChanges: session.finalChanges,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Browser-safe logical-session data. Credentials and host process IDs stay private. */
export async function listGen2AgentSessionMetadata(
  workspaceId: string,
  userId: string,
) {
  await requireGen2Member(workspaceId, userId);
  return (await listGen2AgentSessions(workspaceId)).map(toSafeSession);
}

export async function getGen2AgentSessionMetadata(
  workspaceId: string,
  userId: string,
  sessionId: string,
) {
  await requireGen2Member(workspaceId, userId);
  return toSafeSession(await getGen2AgentSession(workspaceId, sessionId));
}

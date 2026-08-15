import "server-only";

import { getWorkspaceAccess } from "./access";
import { listAgentSessions } from "./agent-runtime";
import { displayMemberName } from "./shared-session-view";
import {
  toWorkboardSlots,
  type WorkboardSession,
  type WorkboardSnapshot,
  type WorkboardViewer,
} from "./workboard-view";

function asWorkboardSession(
  session: Awaited<ReturnType<typeof listAgentSessions>>[number],
): WorkboardSession {
  return {
    id: session.id,
    name: session.name,
    provider: session.provider,
    status: session.status,
    worktreeId: session.worktreeId,
    worktreeName: session.worktreeName,
    worktreeStatus: session.worktreeStatus,
    ownerName: session.ownerName,
    ownerLogin: session.ownerLogin,
    issueTitle: session.issueTitle,
    createdAt: session.createdAt,
    turns: session.turns.map((turn) => ({
      prompt: turn.prompt,
      status: turn.status,
    })),
  };
}

async function viewerFor(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
): Promise<WorkboardViewer> {
  const access = await getWorkspaceAccess(workspaceId, user.id);
  return {
    id: user.id,
    name: displayMemberName(user.name, user.githubLogin),
    canCoSteer: Boolean(access?.permissions.coSteer),
  };
}

export async function loadWorkboardSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  now = new Date(),
): Promise<WorkboardSnapshot> {
  const [viewer, sessions] = await Promise.all([
    viewerFor(workspaceId, user),
    listAgentSessions(workspaceId),
  ]);
  const board = toWorkboardSlots(sessions.map(asWorkboardSession), now);
  return {
    viewer,
    capacity: board.capacity,
    slots: board.slots,
    rejection: null,
  };
}

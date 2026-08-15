import "server-only";

import { identifierSchema } from "@codev/contracts";
import { z } from "zod";

import { getWorkspaceAccess } from "./access";
import {
  cancelOverlappingPathClaim,
  createPathClaim,
  listWorkspaceLivePathClaims,
  reassignPathClaim,
} from "./agent-coordination";
import { listAgentSessions } from "./agent-runtime";
import {
  DEFAULT_CLAIM_INTENT,
  DEFAULT_CLAIM_PATH,
  DEFAULT_CLAIM_REVISION,
  CANCELLED_CLAIM_NOTICE,
  reassignedClaimNotice,
  toPathClaimsSnapshot,
  type PathClaimsSnapshot,
} from "./path-claims-view";
import { displayMemberName } from "./shared-session-view";
import type { WorkboardSession, WorkboardViewer } from "./workboard-view";

const createWorkspacePathClaimSchema = z.object({
  sessionId: identifierSchema,
  path: z.string().trim().min(1).max(500).optional(),
  intent: z.string().trim().min(1).max(2_000).optional(),
  revision: z.string().min(1).max(255).optional(),
  contest: z.boolean().optional(),
});

const claimIdSchema = z.object({
  claimId: identifierSchema,
});

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

export async function loadPathClaimsSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  notice: string | null = null,
): Promise<PathClaimsSnapshot> {
  const [viewer, sessions, claims] = await Promise.all([
    viewerFor(workspaceId, user),
    listAgentSessions(workspaceId),
    listWorkspaceLivePathClaims(workspaceId),
  ]);
  const defaultRevision =
    sessions.find((session) => session.reviewHeadSha?.trim())?.reviewHeadSha ??
    DEFAULT_CLAIM_REVISION;
  return toPathClaimsSnapshot({
    viewer,
    sessions: sessions.map(asWorkboardSession),
    claims,
    defaultRevision,
    notice,
  });
}

export async function createWorkspacePathClaim(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const input = createWorkspacePathClaimSchema.parse(rawInput);
  await createPathClaim(workspaceId, input.sessionId, {
    path: input.path ?? DEFAULT_CLAIM_PATH,
    intent: input.intent ?? DEFAULT_CLAIM_INTENT,
    revision: input.revision ?? DEFAULT_CLAIM_REVISION,
    contest: input.contest ?? false,
  });
  return loadPathClaimsSnapshot(workspaceId, user);
}

export async function reassignWorkspacePathClaim(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const { claimId } = claimIdSchema.parse(rawInput);
  const kept = await reassignPathClaim(workspaceId, claimId);
  const snapshot = await loadPathClaimsSnapshot(workspaceId, user);
  const keptRecord = snapshot.claims.find((claim) => claim.id === kept.id);
  const notice =
    keptRecord?.slot != null
      ? reassignedClaimNotice(keptRecord.slot)
      : "Claim reassigned";
  return { ...snapshot, notice };
}

export async function cancelWorkspacePathClaim(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const { claimId } = claimIdSchema.parse(rawInput);
  await cancelOverlappingPathClaim(workspaceId, claimId);
  return loadPathClaimsSnapshot(workspaceId, user, CANCELLED_CLAIM_NOTICE);
}

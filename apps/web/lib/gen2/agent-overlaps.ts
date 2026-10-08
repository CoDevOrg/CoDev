import "server-only";

import type {
  Gen2AgentOverlap,
  Gen2AgentOverlapListResponse,
} from "@codev/contracts";

import { readSupersetCoordinationOverlaps } from "../runtime/orchestrator-superset-runtime";
import { isGen2AgentCoordinationEnabled } from "./agent-coordination-feature";
import { canRunGen2Agent } from "./agent-policy";
import { listGen2SupersetRuns } from "./superset-runs";
import { requireGen2Member } from "./workspaces";

const ACTIVE_STATUSES = new Set(["creating", "running"]);
const MAX_WORKTREES = 16;

/**
 * Where active agent sessions are changing the same files, for every current
 * member. A guest is asked only when the workspace is ready and two or more
 * worktrees have active agent work, so reading this never wakes a machine.
 */
export async function listGen2AgentOverlaps(
  workspaceId: string,
  userId: string,
): Promise<Gen2AgentOverlapListResponse> {
  const member = await requireGen2Member(workspaceId, userId);
  const none = { overlaps: [], unavailableWorktreeIds: [] };
  if (
    !isGen2AgentCoordinationEnabled(workspaceId) ||
    !canRunGen2Agent(member.status)
  ) {
    return none;
  }
  const runs = (await listGen2SupersetRuns(workspaceId)).filter((run) =>
    ACTIVE_STATUSES.has(run.status),
  );
  const worktreeIds = [...new Set(runs.map((run) => run.worktreeId))].slice(
    0,
    MAX_WORKTREES,
  );
  if (worktreeIds.length < 2) return none;

  const report = await readSupersetCoordinationOverlaps(
    workspaceId,
    worktreeIds,
  );
  const runsIn = (worktreeId: string) =>
    runs.filter((run) => run.worktreeId === worktreeId);
  const overlaps = report.overlaps.flatMap(({ worktreeIds: pair, ...change }) =>
    [pair, [pair[1], pair[0]] as const].flatMap(([own, other]) =>
      runsIn(own).flatMap((run) =>
        runsIn(other).map(
          (otherRun): Gen2AgentOverlap => ({
            runId: run.id,
            otherRunId: otherRun.id,
            otherWorktreeId: other,
            otherProvider: otherRun.provider,
            otherCreatedBy: otherRun.createdBy,
            ...change,
          }),
        ),
      ),
    ),
  );
  return {
    overlaps,
    unavailableWorktreeIds: report.worktrees
      .filter((worktree) => worktree.state !== "known")
      .map((worktree) => worktree.worktreeId),
  };
}

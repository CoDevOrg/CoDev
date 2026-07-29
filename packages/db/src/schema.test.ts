import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agentEvents,
  agentSessions,
  collaborationConflictResolutions,
  coordinationMessages,
  githubIssueAssignments,
  pathClaims,
  workspaceMembers,
  workspaces,
  worktrees,
  yjsSnapshots,
} from "./schema";

describe("database schema", () => {
  it("defines the core workspace tables", () => {
    expect(getTableName(workspaces)).toBe("workspaces");
    expect(getTableName(workspaceMembers)).toBe("workspace_members");
    expect(getTableName(agentSessions)).toBe("agent_sessions");
    expect(getTableName(agentEvents)).toBe("agent_events");
    expect(agentSessions.workflowRunId.name).toBe("workflow_run_id");
    expect(agentEvents.idempotencyKey.name).toBe("idempotency_key");
    expect(getTableName(githubIssueAssignments)).toBe(
      "github_issue_assignments",
    );
    expect(getTableName(pathClaims)).toBe("path_claims");
    expect(getTableName(coordinationMessages)).toBe("coordination_messages");
    expect(getTableName(yjsSnapshots)).toBe("yjs_snapshots");
    expect(yjsSnapshots.stateVector.name).toBe("state_vector_base64");
    expect(yjsSnapshots.filesystemContents.name).toBe("filesystem_contents");
    expect(yjsSnapshots.hasConflict.name).toBe("has_conflict");
    expect(getTableName(collaborationConflictResolutions)).toBe(
      "collaboration_conflict_resolutions",
    );
    expect(coordinationMessages.correlationId.name).toBe("correlation_id");
    expect(worktrees.reviewDiffDigest.name).toBe("review_diff_digest");
    expect(worktrees.mergedAt.name).toBe("merged_at");
    expect(yjsSnapshots.conflictResolvedBy.name).toBe("conflict_resolved_by");
  });
});

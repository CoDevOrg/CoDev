import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { appendWorkspaceEvent } from "./audit";
import { requireWorkspacePermission } from "./access";
import { executeInSandbox } from "./orchestrator";

export class WorkspaceRestoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
// No leading slash, no ".." traversal — everything else git tracks is fair game.
const PATH_PATTERN = /^(?!\/)(?!.*\.\.)[\w.\-/ ]{1,4096}$/;

async function getIntegrationWorktree(workspaceId: string) {
  const [worktree] = await getDatabase()
    .select({ id: schema.worktrees.id, headSha: schema.worktrees.headSha })
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.workspaceId, workspaceId),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .limit(1);
  if (!worktree) {
    throw new WorkspaceRestoreError(
      "Workspace has no integration worktree.",
      404,
    );
  }
  return worktree;
}

async function gitInIntegrationWorktree(
  workspaceId: string,
  worktreeId: string,
  args: string[],
) {
  return executeInSandbox(workspaceId, {
    command: ["git", "--no-pager", "-c", "color.ui=never", ...args],
    worktreeId,
    timeoutSeconds: 30,
  });
}

export type FileHistoryEntry = {
  revision: string;
  author: string;
  date: string;
  message: string;
};

// %x1f/%x1e (unit/record separators) can't collide with a commit subject.
const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

export async function getWorkspaceFileHistory(
  workspaceId: string,
  userId: string,
  path: string,
): Promise<FileHistoryEntry[]> {
  await requireWorkspacePermission(workspaceId, userId, "view");
  if (!PATH_PATTERN.test(path)) {
    throw new WorkspaceRestoreError("Invalid file path.", 400);
  }
  const integration = await getIntegrationWorktree(workspaceId);
  const result = await gitInIntegrationWorktree(workspaceId, integration.id, [
    "log",
    "--max-count=50",
    "--follow",
    `--format=%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`,
    "--",
    path,
  ]);
  if (result.exitCode !== 0) {
    throw new WorkspaceRestoreError(
      result.output.trim() || "Could not read this file's history.",
      422,
    );
  }
  return result.output
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [revision, author, date, message] = record.split(FIELD_SEP);
      return { revision, author, date, message } as FileHistoryEntry;
    })
    .filter((entry) => SHA_PATTERN.test(entry.revision ?? ""));
}

export async function restoreWorkspaceFile(
  workspaceId: string,
  userId: string,
  input: { path: string; revision: string },
) {
  await requireWorkspacePermission(workspaceId, userId, "edit");
  if (!PATH_PATTERN.test(input.path)) {
    throw new WorkspaceRestoreError("Invalid file path.", 400);
  }
  if (!SHA_PATTERN.test(input.revision)) {
    throw new WorkspaceRestoreError("Invalid revision.", 400);
  }
  const integration = await getIntegrationWorktree(workspaceId);
  // Restores into the working tree/index only — nothing is committed, so the
  // member reviews the change in Source Control before it becomes history.
  const result = await gitInIntegrationWorktree(workspaceId, integration.id, [
    "checkout",
    input.revision,
    "--",
    input.path,
  ]);
  if (result.exitCode !== 0) {
    throw new WorkspaceRestoreError(
      result.output.trim() || "Could not restore this file.",
      422,
    );
  }
  await appendWorkspaceEvent({
    workspaceId,
    actorId: userId,
    type: "file.restored",
    payload: {
      path: input.path,
      revision: input.revision,
      worktreeId: integration.id,
    },
  });
  return { path: input.path, revision: input.revision };
}

function backupBranchName() {
  return `codev-restore-backup/${Date.now()}`;
}

export async function restoreWorkspaceToRevision(
  workspaceId: string,
  userId: string,
  input: { revision: string },
) {
  // Discards every uncommitted and committed change since `revision` on the
  // integration worktree, so this is gated at the same "merge" level as
  // integration-affecting review decisions, not the lower "edit" bar.
  await requireWorkspacePermission(workspaceId, userId, "merge");
  if (!SHA_PATTERN.test(input.revision)) {
    throw new WorkspaceRestoreError("Invalid revision.", 400);
  }
  const integration = await getIntegrationWorktree(workspaceId);
  const head = await gitInIntegrationWorktree(workspaceId, integration.id, [
    "rev-parse",
    "HEAD",
  ]);
  if (head.exitCode !== 0) {
    throw new WorkspaceRestoreError(
      "Could not read the current revision.",
      502,
    );
  }
  const previousHeadSha = head.output.trim();
  const backupBranch = backupBranchName();
  // Nothing this restore discards is actually lost: it stays reachable from
  // this branch even after the hard reset below.
  const backup = await gitInIntegrationWorktree(workspaceId, integration.id, [
    "branch",
    backupBranch,
    "HEAD",
  ]);
  if (backup.exitCode !== 0) {
    throw new WorkspaceRestoreError(
      backup.output.trim() ||
        "Could not snapshot the current state before restoring.",
      502,
    );
  }
  const reset = await gitInIntegrationWorktree(workspaceId, integration.id, [
    "reset",
    "--hard",
    input.revision,
  ]);
  if (reset.exitCode !== 0) {
    throw new WorkspaceRestoreError(
      reset.output.trim() || "Could not restore the workspace.",
      422,
    );
  }
  await getDatabase()
    .update(schema.worktrees)
    .set({ headSha: input.revision, updatedAt: new Date() })
    .where(eq(schema.worktrees.id, integration.id));
  await appendWorkspaceEvent({
    workspaceId,
    actorId: userId,
    type: "workspace.restored",
    payload: {
      worktreeId: integration.id,
      revision: input.revision,
      previousHeadSha,
      backupBranch,
    },
  });
  return { revision: input.revision, previousHeadSha, backupBranch };
}

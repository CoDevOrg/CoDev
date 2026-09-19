import "server-only";

import type { CapsuleRepository } from "@codev/contracts";

import type { DecodedSessionCapsule } from "./session-capsule-transport";

export type RepositoryIdentity = Pick<CapsuleRepository, "host" | "path">;

export type RepositoryRestoreResult =
  | { status: "matched"; worktreeId: string }
  | { status: "restored"; worktreeId: string }
  | { status: "conflicted"; conflictPaths: string[] }
  | {
      status: "unavailable" | "transcript_only";
      reason: "repository_mismatch" | "base_commit_unavailable";
    };

export interface SessionRepositoryRuntime {
  getRepositoryIdentity(
    workspaceId: string,
  ): Promise<RepositoryIdentity | null>;
  hasCommit(workspaceId: string, commitSha: string): Promise<boolean>;
  createIsolatedWorktree(input: {
    workspaceId: string;
    importId: string;
    baseCommitSha: string;
  }): Promise<{ worktreeId: string }>;
  restoreRepositoryState(input: {
    workspaceId: string;
    importId: string;
    worktreeId: string;
    baseCommitSha: string;
    files: Array<{
      path: string;
      kind: "patch" | "untracked";
      contents: Uint8Array;
      sha256: string;
      mode: "100644" | "100755";
    }>;
  }): Promise<
    { restored: true } | { restored: false; conflictPaths: string[] }
  >;
  discardWorktree(workspaceId: string, worktreeId: string): Promise<void>;
}

export class SessionRepositoryRestoreError extends Error {
  constructor(
    message: string,
    readonly code = "session_repository_restore_failed",
  ) {
    super(message);
    this.name = "SessionRepositoryRestoreError";
  }
}

function normalizedRepository(identity: RepositoryIdentity) {
  return {
    host: identity.host.trim().toLowerCase(),
    path: identity.path
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase(),
  };
}

export function repositoriesMatch(
  left: RepositoryIdentity,
  right: RepositoryIdentity,
) {
  const normalizedLeft = normalizedRepository(left);
  const normalizedRight = normalizedRepository(right);
  return (
    normalizedLeft.host === normalizedRight.host &&
    normalizedLeft.path === normalizedRight.path
  );
}

function unavailable(
  reason: "repository_mismatch" | "base_commit_unavailable",
  transcriptOnly: boolean,
): RepositoryRestoreResult {
  return { status: transcriptOnly ? "transcript_only" : "unavailable", reason };
}

function requiredFile(
  decoded: DecodedSessionCapsule,
  path: string,
): Uint8Array {
  const contents = decoded.files.get(path);
  if (!contents) {
    throw new SessionRepositoryRestoreError(
      `The verified capsule is missing ${path}.`,
      "session_repository_missing_file",
    );
  }
  return contents;
}

/**
 * Restores only provider-neutral repository state from a verified capsule.
 * Provider payloads and attachments never cross this boundary.
 */
export async function restoreSessionRepository(input: {
  workspaceId: string;
  importId: string;
  decoded: DecodedSessionCapsule;
  runtime: SessionRepositoryRuntime;
  transcriptOnlyOnUnavailable?: boolean;
}): Promise<RepositoryRestoreResult> {
  const { capsule } = input.decoded;
  const destination = await input.runtime.getRepositoryIdentity(
    input.workspaceId,
  );
  if (!destination || !repositoriesMatch(destination, capsule.repository)) {
    return unavailable(
      "repository_mismatch",
      input.transcriptOnlyOnUnavailable ?? false,
    );
  }
  if (
    !(await input.runtime.hasCommit(
      input.workspaceId,
      capsule.repository.baseCommitSha,
    ))
  ) {
    return unavailable(
      "base_commit_unavailable",
      input.transcriptOnlyOnUnavailable ?? false,
    );
  }

  const { worktreeId } = await input.runtime.createIsolatedWorktree({
    workspaceId: input.workspaceId,
    importId: input.importId,
    baseCommitSha: capsule.repository.baseCommitSha,
  });
  try {
    const files: Parameters<
      SessionRepositoryRuntime["restoreRepositoryState"]
    >[0]["files"] = [];
    if (capsule.repositoryState.patchPath) {
      const path = capsule.repositoryState.patchPath;
      const file = capsule.files.find((candidate) => candidate.path === path);
      if (!file || file.role !== "git_patch") {
        throw new SessionRepositoryRestoreError(
          `The verified capsule has invalid patch metadata for ${path}.`,
          "session_repository_missing_file",
        );
      }
      files.push({
        path,
        kind: "patch",
        contents: requiredFile(input.decoded, path),
        sha256: file.sha256,
        mode: "100644",
      });
    }
    for (const path of capsule.repositoryState.approvedUntrackedPaths) {
      const file = capsule.files.find((candidate) => candidate.path === path);
      if (!file || file.role !== "untracked_file") {
        throw new SessionRepositoryRestoreError(
          `The verified capsule has invalid untracked-file metadata for ${path}.`,
          "session_repository_missing_file",
        );
      }
      files.push({
        path,
        kind: "untracked",
        contents: requiredFile(input.decoded, path),
        sha256: file.sha256,
        mode: file.mode,
      });
    }

    const result = await input.runtime.restoreRepositoryState({
      workspaceId: input.workspaceId,
      importId: input.importId,
      worktreeId,
      baseCommitSha: capsule.repository.baseCommitSha,
      files,
    });
    if (!result.restored) {
      await input.runtime.discardWorktree(input.workspaceId, worktreeId);
      return { status: "conflicted", conflictPaths: result.conflictPaths };
    }

    const changed = files.length > 0;
    return { status: changed ? "restored" : "matched", worktreeId };
  } catch (error) {
    await input.runtime
      .discardWorktree(input.workspaceId, worktreeId)
      .catch(() => undefined);
    throw error;
  }
}

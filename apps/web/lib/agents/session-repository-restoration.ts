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
  applyPatch(input: {
    workspaceId: string;
    worktreeId: string;
    patch: Uint8Array;
  }): Promise<{ applied: true } | { applied: false; conflictPaths: string[] }>;
  restoreUntrackedFile(input: {
    workspaceId: string;
    worktreeId: string;
    path: string;
    contents: Uint8Array;
    mode: "100644" | "100755";
  }): Promise<{ restored: true } | { restored: false; conflictPath: string }>;
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
    if (capsule.repositoryState.patchPath) {
      const result = await input.runtime.applyPatch({
        workspaceId: input.workspaceId,
        worktreeId,
        patch: requiredFile(input.decoded, capsule.repositoryState.patchPath),
      });
      if (!result.applied) {
        await input.runtime.discardWorktree(input.workspaceId, worktreeId);
        return { status: "conflicted", conflictPaths: result.conflictPaths };
      }
    }

    for (const path of capsule.repositoryState.approvedUntrackedPaths) {
      const file = capsule.files.find((candidate) => candidate.path === path);
      if (!file || file.role !== "untracked_file") {
        throw new SessionRepositoryRestoreError(
          `The verified capsule has invalid untracked-file metadata for ${path}.`,
          "session_repository_missing_file",
        );
      }
      const result = await input.runtime.restoreUntrackedFile({
        workspaceId: input.workspaceId,
        worktreeId,
        path,
        contents: requiredFile(input.decoded, path),
        mode: file.mode,
      });
      if (!result.restored) {
        await input.runtime.discardWorktree(input.workspaceId, worktreeId);
        return { status: "conflicted", conflictPaths: [result.conflictPath] };
      }
    }

    const changed =
      Boolean(capsule.repositoryState.patchPath) ||
      capsule.repositoryState.approvedUntrackedPaths.length > 0;
    return { status: changed ? "restored" : "matched", worktreeId };
  } catch (error) {
    await input.runtime
      .discardWorktree(input.workspaceId, worktreeId)
      .catch(() => undefined);
    throw error;
  }
}

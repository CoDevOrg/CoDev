import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SessionCapsuleV0 } from "@codev/contracts";

import {
  repositoriesMatch,
  restoreSessionRepository,
  type SessionRepositoryRuntime,
} from "./session-repository-restoration";

const patch = new TextEncoder().encode("diff --git a/a b/a\n");
const untracked = new Uint8Array([0, 1, 2, 255]);
const providerPayload = new TextEncoder().encode("provider state");

function digest(payload: Uint8Array) {
  return createHash("sha256").update(payload).digest("hex");
}

function capsule(withChanges = true): SessionCapsuleV0 {
  return {
    schemaVersion: 0,
    source: {
      provider: "codex",
      externalSessionId: "session-1",
      payloadFormat: "fixture",
      payloadVersion: "1",
    },
    repository: {
      host: "github.com",
      path: "CoDev/Example.git",
      baseCommitSha: "b".repeat(40),
      sourceBranch: "feature/import",
      workingDirectory: ".",
    },
    transcript: [
      {
        sequence: 0,
        role: "user",
        authorName: null,
        text: "Restore this state.",
        createdAt: null,
      },
    ],
    handoff: { currentObjective: "Restore.", summary: "Ready." },
    repositoryState: {
      patchPath: withChanges ? "changes.patch" : null,
      approvedUntrackedPaths: withChanges ? ["notes/context.bin"] : [],
    },
    attachmentPaths: [],
    providerPayloadPath: "provider/session.payload",
    files: [
      ...(withChanges
        ? [
            {
              path: "changes.patch",
              role: "git_patch" as const,
              mediaType: "text/x-diff",
              bytes: patch.byteLength,
              sha256: digest(patch),
              mode: "100644" as const,
            },
            {
              path: "notes/context.bin",
              role: "untracked_file" as const,
              mediaType: "application/octet-stream",
              bytes: untracked.byteLength,
              sha256: digest(untracked),
              mode: "100755" as const,
            },
          ]
        : []),
      {
        path: "provider/session.payload",
        role: "provider_payload",
        mediaType: "application/octet-stream",
        bytes: providerPayload.byteLength,
        sha256: digest(providerPayload),
        mode: "100644",
      },
    ],
    sharing: {
      normalizedView: "workspace",
      opaqueProviderPayload: "importer",
    },
    createdAt: "2026-09-18T12:00:00.000Z",
    exportedAt: "2026-09-18T12:01:00.000Z",
  };
}

function runtime(
  overrides: Partial<SessionRepositoryRuntime> = {},
): SessionRepositoryRuntime {
  return {
    getRepositoryIdentity: vi
      .fn()
      .mockResolvedValue({ host: "GITHUB.COM", path: "codev/example" }),
    hasCommit: vi.fn().mockResolvedValue(true),
    createIsolatedWorktree: vi.fn().mockResolvedValue({ worktreeId: "wt-1" }),
    applyPatch: vi.fn().mockResolvedValue({ applied: true }),
    restoreUntrackedFile: vi.fn().mockResolvedValue({ restored: true }),
    discardWorktree: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function decoded(withChanges = true) {
  return {
    capsule: capsule(withChanges),
    files: new Map([
      ...(withChanges
        ? ([
            ["changes.patch", patch],
            ["notes/context.bin", untracked],
          ] as const)
        : []),
      ["provider/session.payload", providerPayload] as const,
    ]),
  };
}

describe("repository identity", () => {
  it("normalizes GitHub casing, slashes, and .git suffixes", () => {
    expect(
      repositoriesMatch(
        { host: "GitHub.com", path: "/CoDev/Example.git/" },
        { host: "github.com", path: "codev/example" },
      ),
    ).toBe(true);
    expect(
      repositoriesMatch(
        { host: "github.com", path: "codev/other" },
        { host: "github.com", path: "codev/example" },
      ),
    ).toBe(false);
  });
});

describe("session repository restoration", () => {
  it("restores the patch and only approved untracked files", async () => {
    const target = runtime();
    await expect(
      restoreSessionRepository({
        workspaceId: "workspace-1",
        importId: "import-1",
        decoded: decoded(),
        runtime: target,
      }),
    ).resolves.toEqual({ status: "restored", worktreeId: "wt-1" });

    expect(target.applyPatch).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      worktreeId: "wt-1",
      patch,
    });
    expect(target.restoreUntrackedFile).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      worktreeId: "wt-1",
      path: "notes/context.bin",
      contents: untracked,
      mode: "100755",
    });
    expect(target.restoreUntrackedFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: "provider/session.payload" }),
    );
  });

  it("returns matched when the base needs no repository changes", async () => {
    await expect(
      restoreSessionRepository({
        workspaceId: "workspace-1",
        importId: "import-1",
        decoded: decoded(false),
        runtime: runtime(),
      }),
    ).resolves.toEqual({ status: "matched", worktreeId: "wt-1" });
  });

  it("does not create a worktree for a different repository or missing base", async () => {
    const mismatch = runtime({
      getRepositoryIdentity: vi
        .fn()
        .mockResolvedValue({ host: "github.com", path: "other/repo" }),
    });
    await expect(
      restoreSessionRepository({
        workspaceId: "workspace-1",
        importId: "import-1",
        decoded: decoded(),
        runtime: mismatch,
        transcriptOnlyOnUnavailable: true,
      }),
    ).resolves.toEqual({
      status: "transcript_only",
      reason: "repository_mismatch",
    });
    expect(mismatch.createIsolatedWorktree).not.toHaveBeenCalled();

    const missingBase = runtime({
      hasCommit: vi.fn().mockResolvedValue(false),
    });
    await expect(
      restoreSessionRepository({
        workspaceId: "workspace-1",
        importId: "import-1",
        decoded: decoded(),
        runtime: missingBase,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "base_commit_unavailable",
    });
    expect(missingBase.createIsolatedWorktree).not.toHaveBeenCalled();
  });

  it("reports conflicts and discards the partial isolated worktree", async () => {
    const target = runtime({
      applyPatch: vi
        .fn()
        .mockResolvedValue({ applied: false, conflictPaths: ["src/app.ts"] }),
    });
    await expect(
      restoreSessionRepository({
        workspaceId: "workspace-1",
        importId: "import-1",
        decoded: decoded(),
        runtime: target,
      }),
    ).resolves.toEqual({
      status: "conflicted",
      conflictPaths: ["src/app.ts"],
    });
    expect(target.discardWorktree).toHaveBeenCalledWith("workspace-1", "wt-1");
    expect(target.restoreUntrackedFile).not.toHaveBeenCalled();
  });
});

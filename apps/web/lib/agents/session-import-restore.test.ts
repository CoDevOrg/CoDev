import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  capsuleSha256: vi.fn(),
  runtime: {},
}));

vi.mock("./session-capsule-transport", () => ({
  decodeSessionCapsuleTransport: mocks.decode,
}));
vi.mock("./session-import-storage", () => ({
  readSessionImportArtifact: vi.fn(),
  sessionCapsuleSha256: mocks.capsuleSha256,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE:
    "application/vnd.codev.session-capsule.v0",
}));
vi.mock("./session-repository-sandbox-runtime", () => ({
  createSandboxSessionRepositoryRuntime: () => mocks.runtime,
}));
vi.mock("../runtime/runtime-resume", () => ({
  ensureWorkspaceRuntimeReady: vi.fn(),
}));
vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));

import { restoreStoredSessionImport } from "./session-import-restore";

const input = {
  workspaceId: "workspace-1",
  importId: "import-1",
  importedBy: "user-1",
};

function fakeDatabase(record: Record<string, unknown> | null) {
  const limit = vi.fn().mockResolvedValue(record ? [record] : []);
  const query = { from: vi.fn(), where: vi.fn(), limit };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return { select: vi.fn(() => query) };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    status: "stored",
    repositoryStatus: "pending",
    capsuleSha256: "capsule-hash",
    worktreeId: null,
    ...overrides,
  };
}

describe("session import restore trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decode.mockReturnValue({
      capsule: { schemaVersion: 0 },
      files: new Map(),
    });
    mocks.capsuleSha256.mockReturnValue("capsule-hash");
  });

  it("restores a scoped import and only marks it ready after success", async () => {
    const transitionImport = vi.fn().mockResolvedValue({ changed: true });
    const transitionRepository = vi.fn().mockResolvedValue({ changed: true });
    const restore = vi.fn().mockResolvedValue({
      status: "restored",
      worktreeId: "worktree-1",
    });
    const ensureRuntime = vi.fn();
    const readArtifact = vi.fn().mockResolvedValue({
      mediaType: "application/vnd.codev.session-capsule.v0",
      payload: new Uint8Array([1]),
    });

    await expect(
      restoreStoredSessionImport(input, {
        database: fakeDatabase(record()) as never,
        transitionImport,
        transitionRepository,
        restore,
        ensureRuntime,
        readArtifact,
      }),
    ).resolves.toEqual({
      status: "ready",
      repositoryStatus: "restored",
      worktreeId: "worktree-1",
    });
    expect(transitionImport.mock.calls.map(([value]) => value.to)).toEqual([
      "restoring",
      "ready",
    ]);
    expect(transitionRepository).toHaveBeenCalledWith({
      scope: {
        organizationId: "org-1",
        workspaceId: "workspace-1",
        importId: "import-1",
        importedBy: "user-1",
      },
      to: "restored",
    });
    expect(readArtifact).toHaveBeenCalledTimes(1);
    expect(ensureRuntime).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "coSteer",
    );
  });

  it("keeps a conflict in restoring until transcript-only is explicitly chosen", async () => {
    const transitionImport = vi.fn();
    const transitionRepository = vi.fn();
    const result = await restoreStoredSessionImport(input, {
      database: fakeDatabase(record({ status: "restoring" })) as never,
      transitionImport,
      transitionRepository,
      readArtifact: vi.fn().mockResolvedValue({
        mediaType: "application/vnd.codev.session-capsule.v0",
        payload: new Uint8Array([1]),
      }),
      ensureRuntime: vi.fn(),
      restore: vi.fn().mockResolvedValue({
        status: "conflicted",
        conflictPaths: ["src/app.ts"],
      }),
    });
    expect(result).toEqual({
      status: "restoring",
      repositoryStatus: "conflicted",
      worktreeId: null,
      conflictPaths: ["src/app.ts"],
    });
    expect(transitionRepository).toHaveBeenCalledWith(
      expect.objectContaining({ to: "conflicted" }),
    );
    expect(transitionImport).not.toHaveBeenCalled();
  });

  it("retries an unavailable base commit without silently choosing transcript-only", async () => {
    const transitionImport = vi.fn();
    const transitionRepository = vi.fn();
    const restore = vi.fn().mockResolvedValue({
      status: "restored",
      worktreeId: "recovered-worktree",
    });
    await expect(
      restoreStoredSessionImport(input, {
        database: fakeDatabase(
          record({ status: "restoring", repositoryStatus: "unavailable" }),
        ) as never,
        transitionImport,
        transitionRepository,
        restore,
        ensureRuntime: vi.fn(),
        readArtifact: vi.fn().mockResolvedValue({
          mediaType: "application/vnd.codev.session-capsule.v0",
          payload: new Uint8Array([1]),
        }),
      }),
    ).resolves.toEqual({
      status: "ready",
      repositoryStatus: "restored",
      worktreeId: "recovered-worktree",
    });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(transitionRepository).toHaveBeenCalledWith(
      expect.objectContaining({ to: "restored" }),
    );
  });

  it("accepts transcript-only only after a recorded conflict", async () => {
    const transitionImport = vi.fn();
    const transitionRepository = vi.fn();
    const readArtifact = vi.fn();
    const database = fakeDatabase(
      record({
        status: "restoring",
        repositoryStatus: "conflicted",
      }),
    );
    await expect(
      restoreStoredSessionImport(
        { ...input, transcriptOnly: true },
        {
          database: database as never,
          transitionImport,
          transitionRepository,
          readArtifact,
        },
      ),
    ).resolves.toEqual({
      status: "ready",
      repositoryStatus: "transcript_only",
      worktreeId: null,
    });
    expect(transitionRepository).toHaveBeenCalledWith(
      expect.objectContaining({ to: "transcript_only" }),
    );
    expect(transitionImport).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ready" }),
    );
    expect(readArtifact).not.toHaveBeenCalled();
  });

  it("rejects a transcript-only request before repository handling", async () => {
    await expect(
      restoreStoredSessionImport(
        { ...input, transcriptOnly: true },
        { database: fakeDatabase(record()) as never },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not expose another importer's record", async () => {
    await expect(
      restoreStoredSessionImport(input, {
        database: fakeDatabase(null) as never,
      }),
    ).rejects.toMatchObject({ status: 404, code: "session_import_not_found" });
  });
});

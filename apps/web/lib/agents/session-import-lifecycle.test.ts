import { describe, expect, it, vi } from "vitest";

import {
  assertRepositoryRestoreTransition,
  assertRepositoryReady,
  assertSessionImportTransition,
  SessionImportLifecycleError,
  selectSessionImportContinuation,
  transitionSessionImport,
  transitionSessionImportRepository,
} from "./session-import-lifecycle";

const scope = {
  organizationId: "org-1",
  workspaceId: "workspace-1",
  importId: "import-1",
  importedBy: "user-1",
};

function fakeDatabase(
  record: Record<string, unknown>,
  updateResult: Record<string, unknown>[] = [{ status: "ready" }],
) {
  const returning = vi.fn().mockResolvedValue(updateResult);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const limit = vi.fn().mockResolvedValue([record]);
  return {
    database: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
      })),
      update: vi.fn(() => ({ set })),
    },
    returning,
  };
}

describe("session import lifecycle transitions", () => {
  it("accepts the normal restore, launch, and release sequence", () => {
    expect(() =>
      assertSessionImportTransition("stored", "restoring"),
    ).not.toThrow();
    expect(() =>
      assertSessionImportTransition("restoring", "ready"),
    ).not.toThrow();
    expect(() =>
      assertSessionImportTransition("ready", "launching"),
    ).not.toThrow();
    expect(() =>
      assertSessionImportTransition("launching", "active"),
    ).not.toThrow();
    expect(() =>
      assertSessionImportTransition("active", "ready"),
    ).not.toThrow();
  });

  it("accepts idempotent retries without creating a second transition", () => {
    expect(() => assertSessionImportTransition("ready", "ready")).not.toThrow();
  });

  it("rejects skipped and terminal-state transitions", () => {
    expect(() => assertSessionImportTransition("stored", "active")).toThrow(
      SessionImportLifecycleError,
    );
    expect(() => assertSessionImportTransition("failed", "ready")).toThrow(
      SessionImportLifecycleError,
    );
    expect(() => assertSessionImportTransition("deleted", "stored")).toThrow(
      SessionImportLifecycleError,
    );
  });
});

describe("repository restoration transitions", () => {
  it("supports verified restoration and transcript-only fallback", () => {
    expect(() =>
      assertRepositoryRestoreTransition("pending", "matched"),
    ).not.toThrow();
    expect(() =>
      assertRepositoryRestoreTransition("matched", "restored"),
    ).not.toThrow();
    expect(() =>
      assertRepositoryRestoreTransition("unavailable", "transcript_only"),
    ).not.toThrow();
    expect(() =>
      assertRepositoryRestoreTransition("conflicted", "transcript_only"),
    ).not.toThrow();
  });

  it("does not allow a completed result to be rewritten", () => {
    expect(() =>
      assertRepositoryRestoreTransition("restored", "conflicted"),
    ).toThrow(SessionImportLifecycleError);
    expect(() =>
      assertRepositoryRestoreTransition("transcript_only", "restored"),
    ).toThrow(SessionImportLifecycleError);
  });

  it("only marks verified, restored, or transcript-only imports ready", () => {
    for (const status of ["matched", "restored", "transcript_only"] as const) {
      expect(() => assertRepositoryReady(status)).not.toThrow();
    }
    for (const status of ["pending", "conflicted", "unavailable"] as const) {
      expect(() => assertRepositoryReady(status)).toThrow(
        SessionImportLifecycleError,
      );
    }
  });
});

describe("persisted session import transitions", () => {
  it("requires a completed repository result before becoming ready", async () => {
    const { database } = fakeDatabase({
      status: "restoring",
      repositoryStatus: "conflicted",
      continuationMode: null,
    });

    await expect(
      transitionSessionImport(
        { scope, to: "ready" },
        { database: database as never, appendEvent: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "session_import_repository_not_ready" });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("requires a continuation choice before launching", async () => {
    const { database } = fakeDatabase({
      status: "ready",
      repositoryStatus: "restored",
      continuationMode: null,
    });

    await expect(
      transitionSessionImport(
        { scope, to: "launching" },
        { database: database as never, appendEvent: vi.fn() },
      ),
    ).rejects.toMatchObject({
      code: "session_import_continuation_not_selected",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("turns the native-writer unique constraint into a scoped conflict", async () => {
    const { database, returning } = fakeDatabase({
      status: "ready",
      repositoryStatus: "restored",
      continuationMode: "native_resume",
    });
    returning.mockRejectedValue({
      code: "23505",
      constraint: "agent_session_imports_active_writer_idx",
    });

    await expect(
      transitionSessionImport(
        { scope, to: "launching" },
        { database: database as never, appendEvent: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "session_import_active_writer_conflict" });
  });

  it("writes metadata-only transition events after a successful CAS", async () => {
    const { database } = fakeDatabase({
      status: "stored",
      repositoryStatus: "pending",
      continuationMode: null,
    });
    const appendEvent = vi.fn();

    await expect(
      transitionSessionImport(
        { scope, to: "restoring" },
        { database: database as never, appendEvent },
      ),
    ).resolves.toEqual({ changed: true, status: "restoring" });
    expect(appendEvent).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      actorId: scope.importedBy,
      type: "agent_session_import.status_changed",
      payload: { importId: scope.importId, from: "stored", to: "restoring" },
    });
  });

  it("changes repository state only during restoration", async () => {
    const { database } = fakeDatabase({
      status: "ready",
      repositoryStatus: "pending",
    });

    await expect(
      transitionSessionImportRepository(
        { scope, to: "transcript_only" },
        { database: database as never, appendEvent: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "session_import_not_restoring" });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("selects or changes continuation only while ready", async () => {
    const ready = fakeDatabase({
      status: "ready",
      continuationMode: null,
    });
    const appendEvent = vi.fn();
    await expect(
      selectSessionImportContinuation(
        { scope, mode: "managed" },
        { database: ready.database as never, appendEvent },
      ),
    ).resolves.toEqual({ changed: true, continuationMode: "managed" });
    expect(appendEvent).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      actorId: scope.importedBy,
      type: "agent_session_import.continuation_selected",
      payload: { importId: scope.importId, mode: "managed" },
    });

    const launching = fakeDatabase({
      status: "launching",
      continuationMode: "managed",
    });
    await expect(
      selectSessionImportContinuation(
        { scope, mode: "native_resume" },
        { database: launching.database as never, appendEvent: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "session_import_not_ready" });
    expect(launching.database.update).not.toHaveBeenCalled();
  });
});

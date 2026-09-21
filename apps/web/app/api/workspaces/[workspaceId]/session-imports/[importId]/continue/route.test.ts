import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  continueStoredSessionImport: vi.fn(),
  restoreStoredSessionImport: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/auth/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/agents/session-import-continuation", () => ({
  continueStoredSessionImport: mocks.continueStoredSessionImport,
}));
vi.mock("@/lib/agents/session-import-lifecycle", () => ({
  SessionImportLifecycleError: class extends Error {
    constructor(
      message: string,
      readonly status = 409,
      readonly code = "session_import_invalid_transition",
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/agents/session-import-restore", () => ({
  restoreStoredSessionImport: mocks.restoreStoredSessionImport,
  SessionImportRestoreError: class extends Error {
    constructor(
      message: string,
      readonly status = 409,
      readonly code = "session_import_restore_error",
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/agents/session-import-storage", () => ({
  SessionImportStorageError: class extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
}));

import { SessionImportLifecycleError } from "@/lib/agents/session-import-lifecycle";

import { POST } from "./route";

function invoke(body = "{}") {
  return POST(
    new Request(
      "https://codev.test/api/workspaces/workspace-1/session-imports/import-1/continue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    ),
    {
      params: Promise.resolve({
        workspaceId: "workspace-1",
        importId: "import-1",
      }),
    },
  );
}

describe("session import continuation route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "member-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
  });

  it("creates a managed continuation for the scoped import", async () => {
    mocks.continueStoredSessionImport.mockResolvedValue({
      sessionId: "session-1",
      created: true,
    });
    const response = await invoke();

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      sessionId: "session-1",
      created: true,
    });
    expect(mocks.continueStoredSessionImport).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      importId: "import-1",
      importedBy: "member-1",
    });
  });

  it("prepares the repository automatically before creating the continuation", async () => {
    mocks.continueStoredSessionImport
      .mockRejectedValueOnce(
        new SessionImportLifecycleError(
          "Restore first.",
          409,
          "session_import_not_ready",
        ),
      )
      .mockResolvedValueOnce({ sessionId: "session-1", created: true });
    mocks.restoreStoredSessionImport.mockResolvedValue({
      status: "ready",
      repositoryStatus: "restored",
      worktreeId: "worktree-1",
    });

    const response = await invoke();

    expect(response.status).toBe(201);
    expect(mocks.restoreStoredSessionImport).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      importId: "import-1",
      importedBy: "member-1",
    });
    expect(mocks.continueStoredSessionImport).toHaveBeenCalledTimes(2);
  });

  it("returns a recoverable conflict when automatic preparation needs attention", async () => {
    mocks.continueStoredSessionImport.mockRejectedValue(
      new SessionImportLifecycleError(
        "Restore first.",
        409,
        "session_import_not_ready",
      ),
    );
    mocks.restoreStoredSessionImport.mockResolvedValue({
      status: "restoring",
      repositoryStatus: "conflicted",
      worktreeId: null,
      conflictPaths: ["src/app.ts"],
    });

    const response = await invoke();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "CoDev could not apply the imported repository changes. Review the repository issue below and retry.",
    });
    expect(mocks.continueStoredSessionImport).toHaveBeenCalledOnce();
  });

  it("passes chat-only continuation through without restoring the repository", async () => {
    mocks.continueStoredSessionImport.mockResolvedValue({
      sessionId: "chat-session-1",
      created: true,
    });

    const response = await invoke(JSON.stringify({ chatOnly: true }));

    expect(response.status).toBe(201);
    expect(mocks.continueStoredSessionImport).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      importId: "import-1",
      importedBy: "member-1",
      chatOnly: true,
    });
    expect(mocks.restoreStoredSessionImport).not.toHaveBeenCalled();
  });

  it("does not expose internal continuation failures", async () => {
    mocks.continueStoredSessionImport.mockRejectedValue(
      new Error("database host private.internal refused connection"),
    );
    const response = await invoke();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The CoDev session could not be created. Please try again.",
    });
  });
});

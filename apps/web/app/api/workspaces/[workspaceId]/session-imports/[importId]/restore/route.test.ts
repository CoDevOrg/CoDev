import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
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
vi.mock("@/lib/agents/session-import-restore", () => ({
  restoreStoredSessionImport: mocks.restoreStoredSessionImport,
  SessionImportRestoreError: class extends Error {
    constructor(
      message: string,
      readonly status = 409,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/agents/session-import-lifecycle", () => ({
  SessionImportLifecycleError: class extends Error {
    constructor(
      message: string,
      readonly status = 409,
    ) {
      super(message);
    }
  },
}));

import { POST } from "./route";

function invoke() {
  return POST(
    new Request(
      "https://codev.test/api/workspaces/workspace-1/session-imports/import-1/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
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

describe("session import restore intake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "member-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
  });

  it("does not return Key Vault details from a restore failure", async () => {
    mocks.restoreStoredSessionImport.mockRejectedValue(
      new Error("Key Vault denied unwrap for caller oid=private-id"),
    );
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "The repository could not be restored. Please try again or contact your workspace administrator.",
    });
  });
});

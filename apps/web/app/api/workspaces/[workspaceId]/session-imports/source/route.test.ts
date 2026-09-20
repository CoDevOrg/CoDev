import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeSessionCapsuleTransport } from "@/lib/agents/session-capsule-transport";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  storeSessionImport: vi.fn(),
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
vi.mock("@/lib/agents/session-import-storage", () => ({
  storeSessionImport: mocks.storeSessionImport,
  SessionImportStorageError: class extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const source = [
  JSON.stringify({
    type: "session_meta",
    payload: {
      id: "019a88ba-5df0-77c1-83e3-1413a0bce76d",
      timestamp: "2025-11-15T18:15:06.480Z",
      git: {
        repository_url: "https://github.com/codev/example.git",
        commit_hash: "a".repeat(40),
        branch: "main",
      },
    },
  }),
  JSON.stringify({
    type: "event_msg",
    payload: { type: "user_message", message: "Continue this task" },
  }),
].join("\n");

function invoke(body = source, headers: Record<string, string> = {}) {
  return POST(
    new Request(
      `https://codev.test/api/workspaces/${workspaceId}/session-imports/source`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-ndjson",
          "x-session-provider": "codex",
          "idempotency-key": "source-1",
          ...headers,
        },
        body,
      },
    ),
    { params: Promise.resolve({ workspaceId }) },
  );
}

describe("provider source import intake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "member-1" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.storeSessionImport.mockResolvedValue({
      importId: "import-1",
      created: true,
    });
  });

  it("authorizes and stores a verified internal capsule", async () => {
    const response = await invoke();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      importId: "import-1",
      created: true,
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      "member-1",
      "coSteer",
    );
    const input = mocks.storeSessionImport.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      workspaceId,
      importedBy: "member-1",
      idempotencyKey: "source-1",
    });
    expect(
      decodeSessionCapsuleTransport(input.artifact).capsule.source.provider,
    ).toBe("codex");
  });

  it("rejects invalid source before storage", async () => {
    const response = await invoke("not a rollout");
    expect(response.status).toBe(400);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("hides infrastructure details when storage fails", async () => {
    mocks.storeSessionImport.mockRejectedValue(
      new Error("Caller oid=private-id cannot wrap Key Vault key secret-name"),
    );
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "The session could not be saved. Please try again or contact your workspace administrator.",
    });
  });

  it("keeps a safe idempotency conflict actionable", async () => {
    const { SessionImportStorageError } =
      await import("@/lib/agents/session-import-storage");
    mocks.storeSessionImport.mockRejectedValue(
      new SessionImportStorageError(
        "This idempotency key was already used for different capsule content.",
        409,
      ),
    );
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "This idempotency key was already used for different capsule content.",
    });
  });
});

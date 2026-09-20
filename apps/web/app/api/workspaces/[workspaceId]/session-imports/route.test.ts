import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionCapsuleV0 } from "@codev/contracts";

import {
  encodeSessionCapsuleTransport,
  MAX_SESSION_CAPSULE_TRANSPORT_BYTES,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
} from "@/lib/agents/session-capsule-transport";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  storeSessionImport: vi.fn(),
  readStoredSessionImportState: vi.fn(),
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
  readStoredSessionImportState: mocks.readStoredSessionImportState,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const payload = new TextEncoder().encode("native session payload");

function capsule(): SessionCapsuleV0 {
  return {
    schemaVersion: 0,
    source: {
      provider: "claude",
      externalSessionId: "claude-session-1",
      payloadFormat: "fixture",
      payloadVersion: "1",
    },
    repository: {
      host: "github.com",
      path: "codev/example",
      baseCommitSha: "b".repeat(40),
      sourceBranch: "feature/import",
      workingDirectory: ".",
    },
    transcript: [
      {
        sequence: 0,
        role: "user",
        authorName: null,
        text: "Continue the import.",
        createdAt: "2026-09-18T12:00:00.000Z",
      },
    ],
    handoff: {
      currentObjective: "Review the imported session.",
      summary: "The session has one message.",
    },
    repositoryState: { patchPath: null, approvedUntrackedPaths: [] },
    attachmentPaths: [],
    providerPayloadPath: "provider/session.payload",
    files: [
      {
        path: "provider/session.payload",
        role: "provider_payload",
        mediaType: "application/octet-stream",
        bytes: payload.byteLength,
        sha256: createHash("sha256").update(payload).digest("hex"),
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

function artifact() {
  return encodeSessionCapsuleTransport({
    capsule: capsule(),
    files: new Map([["provider/session.payload", payload]]),
  });
}

function request(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request(
    `https://codev.test/api/workspaces/${workspaceId}/session-imports`,
    {
      method: "POST",
      headers: {
        "content-type": SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
        "idempotency-key": "upload-1",
        ...headers,
      },
      body: Buffer.from(body),
    },
  );
}

function invoke(input: Request) {
  return POST(input, { params: Promise.resolve({ workspaceId }) });
}

describe("session import intake", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.storeSessionImport.mockResolvedValue({
      importId: "import-1",
      created: true,
      status: "stored",
    });
    mocks.readStoredSessionImportState.mockResolvedValue({
      status: "stored",
      repositoryStatus: "pending",
      worktreeId: null,
    });
  });

  afterEach(() => vi.resetAllMocks());

  it("stores a verified capsule and returns only normalized import details", async () => {
    const bytes = artifact();
    const response = await invoke(request(bytes));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "coSteer",
    );
    expect(mocks.storeSessionImport).toHaveBeenCalledWith({
      workspaceId,
      importedBy: userId,
      idempotencyKey: "upload-1",
      artifact: bytes,
    });
    const result = await response.json();
    expect(result).toMatchObject({
      importId: "import-1",
      created: true,
      status: "stored",
      source: { provider: "claude", externalSessionId: "claude-session-1" },
      transcript: { entryCount: 1 },
      handoff: { currentObjective: "Review the imported session." },
      repository: { status: "pending", worktreeId: null },
      actions: { restoreRepository: true, acceptTranscriptOnly: false },
    });
    expect(JSON.stringify(result)).not.toContain("native session payload");
  });

  it("rejects invalid capsules before storing them", async () => {
    const bytes = artifact();
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    const response = await invoke(request(bytes));

    expect(response.status).toBe(400);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("rejects unsupported media types and missing idempotency keys", async () => {
    expect(
      (
        await invoke(
          request(artifact(), { "content-type": "application/json" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await invoke(request(artifact(), { "idempotency-key": "" }))).status,
    ).toBe(400);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads before decoding or storing", async () => {
    const response = await invoke(
      request(new Uint8Array([1]), {
        "content-length": String(MAX_SESSION_CAPSULE_TRANSPORT_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("stops an oversized stream without a content-length header", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SESSION_CAPSULE_TRANSPORT_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const response = await invoke(
      new Request(
        `https://codev.test/api/workspaces/${workspaceId}/session-imports`,
        {
          method: "POST",
          headers: {
            "content-type": SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
            "idempotency-key": "upload-1",
          },
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      ),
    );

    expect(response.status).toBe(413);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("preserves authorization failures before reading the capsule", async () => {
    mocks.requireWorkspacePermission.mockRejectedValue(
      Object.assign(new Error("Not allowed."), { status: 403 }),
    );
    const response = await invoke(request(artifact()));

    expect(response.status).toBe(403);
    expect(mocks.storeSessionImport).not.toHaveBeenCalled();
  });

  it("reports the current state for an idempotent retry", async () => {
    mocks.storeSessionImport.mockResolvedValue({
      importId: "import-1",
      created: false,
      status: "restoring",
    });
    mocks.readStoredSessionImportState.mockResolvedValue({
      status: "restoring",
      repositoryStatus: "conflicted",
      worktreeId: null,
    });
    const response = await invoke(request(artifact()));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      created: false,
      status: "restoring",
      repository: { status: "conflicted" },
      actions: { restoreRepository: true, acceptTranscriptOnly: true },
    });
  });
});

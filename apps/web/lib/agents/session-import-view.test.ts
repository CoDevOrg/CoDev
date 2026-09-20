import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  capsuleSha256: vi.fn(),
}));

vi.mock("./session-capsule-transport", () => ({
  decodeSessionCapsuleTransport: mocks.decode,
}));
vi.mock("./session-import-storage", () => ({
  sessionCapsuleSha256: mocks.capsuleSha256,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE:
    "application/vnd.codev.session-capsule.v0",
  SessionImportStorageError: class SessionImportStorageError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

import { readStoredSessionImportView } from "./session-import-view";

const input = {
  workspaceId: "workspace-1",
  importId: "import-1",
  importedBy: "member-1",
};

function database(record: Record<string, unknown> | undefined) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(record ? [record] : []),
        })),
      })),
    })),
  } as never;
}

const record = {
  organizationId: "org-1",
  status: "restoring",
  repositoryStatus: "conflicted",
  worktreeId: null,
  capsuleSha256: "expected-digest",
  createdAt: new Date("2026-09-18T12:00:00.000Z"),
};

function artifact() {
  return {
    mediaType: "application/vnd.codev.session-capsule.v0",
    payload: new Uint8Array([1]),
    sha256: "a".repeat(64),
    bytes: 1,
  };
}

describe("stored session import view", () => {
  it("does not read an artifact when the import is not in the caller's scope", async () => {
    const readArtifact = vi.fn();
    await expect(
      readStoredSessionImportView(input, {
        database: database(undefined),
        readArtifact,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(readArtifact).not.toHaveBeenCalled();
  });

  it("rejects a capsule whose identity differs from the stored import", async () => {
    mocks.decode.mockReturnValue({ capsule: { transcript: [] } });
    mocks.capsuleSha256.mockReturnValue("different-digest");
    await expect(
      readStoredSessionImportView(input, {
        database: database(record),
        readArtifact: vi.fn().mockResolvedValue(artifact()),
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("returns normalized data and limits the displayed transcript", async () => {
    const transcript = Array.from({ length: 51 }, (_, sequence) => ({
      sequence,
      role: "user",
      text: `Message ${sequence}`,
      authorName: null,
      createdAt: null,
    }));
    mocks.decode.mockReturnValue({
      capsule: {
        source: { provider: "claude", externalSessionId: "source-1" },
        repository: { host: "github.com", path: "codev/example" },
        handoff: { currentObjective: "Continue", summary: "Summary" },
        transcript,
        providerPayloadPath: "secret/native.bin",
      },
    });
    mocks.capsuleSha256.mockReturnValue("expected-digest");
    const readArtifact = vi.fn().mockResolvedValue(artifact());
    const view = await readStoredSessionImportView(input, {
      database: database(record),
      readArtifact,
    });

    expect(readArtifact).toHaveBeenCalledWith({
      organizationId: "org-1",
      workspaceId: input.workspaceId,
      importId: input.importId,
      importedBy: input.importedBy,
    });
    expect(view.transcript.totalEntries).toBe(51);
    expect(view.transcript.entries).toHaveLength(50);
    expect(view.transcript.entries[0]?.sequence).toBe(1);
    expect(JSON.stringify(view)).not.toContain("secret/native.bin");
  });
});

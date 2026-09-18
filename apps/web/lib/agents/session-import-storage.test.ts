import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionCapsuleV0 } from "@codev/contracts";

vi.mock("../platform/azure-kms", () => ({
  AZURE_VERSION: "akv-v1",
  decryptWithAzure: vi.fn(),
  encryptWithAzure: vi.fn(),
  getKeyVaultKeyId: () => undefined,
}));

import {
  assertMatchingIdempotentImport,
  decryptSessionImportArtifact,
  encryptSessionImportArtifact,
  MAX_STORED_SESSION_CAPSULE_BYTES,
  resolveStoredImportStatus,
  sessionCapsuleSha256,
  SessionImportStorageError,
  storeSessionImport,
  type SessionImportArtifactScope,
} from "./session-import-storage";

const scope: SessionImportArtifactScope = {
  organizationId: "org-1",
  workspaceId: "workspace-1",
  importId: "import-1",
  importedBy: "user-1",
};

function capsule(): SessionCapsuleV0 {
  return {
    schemaVersion: 0,
    source: {
      provider: "claude",
      externalSessionId: "claude-session-1",
      payloadFormat: "claude-fixture",
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
        text: "Continue from this capsule.",
        createdAt: "2026-09-18T12:00:00.000Z",
      },
    ],
    handoff: {
      currentObjective: "Continue the import.",
      summary: "The portable state is ready.",
    },
    repositoryState: { patchPath: null, approvedUntrackedPaths: [] },
    attachmentPaths: [],
    providerPayloadPath: "provider/session.payload",
    files: [
      {
        path: "provider/session.payload",
        role: "provider_payload",
        mediaType: "application/octet-stream",
        bytes: 7,
        sha256: "a".repeat(64),
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

function digest(payload: Uint8Array) {
  return createHash("sha256").update(payload).digest("hex");
}

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  delete process.env.CREDENTIAL_KEY_VAULT_KEY_ID;
});

afterEach(() => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.CREDENTIAL_KEY_VAULT_KEY_ID;
});

describe("session import artifact encryption", () => {
  it("round-trips binary capsule bytes with a scoped encryption context", async () => {
    const payload = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const sealed = await encryptSessionImportArtifact({
      scope,
      payload,
      expectedSha256: digest(payload),
    });

    await expect(
      decryptSessionImportArtifact({ scope, ...sealed }),
    ).resolves.toEqual(payload);
    expect(sealed.encryptedPayload).not.toContain(
      Buffer.from(payload).toString("base64url"),
    );
  });

  it("rejects ciphertext replayed under another workspace or importer", async () => {
    const payload = new TextEncoder().encode("private capsule material");
    const sealed = await encryptSessionImportArtifact({
      scope,
      payload,
      expectedSha256: digest(payload),
    });

    await expect(
      decryptSessionImportArtifact({
        scope: { ...scope, workspaceId: "workspace-2" },
        ...sealed,
      }),
    ).rejects.toThrow();
    await expect(
      decryptSessionImportArtifact({
        scope: { ...scope, importedBy: "user-2" },
        ...sealed,
      }),
    ).rejects.toThrow();
  });

  it("rejects a bad incoming checksum and tampered stored metadata", async () => {
    const payload = new TextEncoder().encode("capsule");
    await expect(
      encryptSessionImportArtifact({
        scope,
        payload,
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "session_import_checksum_mismatch" });

    const sealed = await encryptSessionImportArtifact({
      scope,
      payload,
      expectedSha256: digest(payload),
    });
    await expect(
      decryptSessionImportArtifact({
        scope,
        ...sealed,
        plaintextBytes: sealed.plaintextBytes + 1,
      }),
    ).rejects.toMatchObject({ code: "session_import_integrity_failure" });
  });

  it("bounds the encrypted PostgreSQL artifact", async () => {
    const oversized = new Uint8Array(MAX_STORED_SESSION_CAPSULE_BYTES + 1);
    await expect(
      encryptSessionImportArtifact({
        scope,
        payload: oversized,
        expectedSha256: digest(oversized),
      }),
    ).rejects.toMatchObject({ status: 413, code: "session_import_too_large" });
  });
});

describe("session import idempotency", () => {
  it("accepts the same digest and rejects key reuse with different content", () => {
    expect(() => assertMatchingIdempotentImport("a", "a")).not.toThrow();
    expect(() => assertMatchingIdempotentImport("a", "b")).toThrow(
      SessionImportStorageError,
    );
  });

  it("does not move an advanced import backward during an artifact retry", () => {
    expect(resolveStoredImportStatus("storing")).toBe("stored");
    expect(resolveStoredImportStatus("failed")).toBe("stored");
    expect(resolveStoredImportStatus("ready")).toBe("ready");
    expect(resolveStoredImportStatus("active")).toBe("active");
    expect(resolveStoredImportStatus("deleted")).toBe("deleted");
  });

  it("returns an existing semantic capsule without replacing its artifact bytes", async () => {
    const value = capsule();
    const firstSelect = {
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ organizationId: "org-1" }]),
          })),
        })),
      })),
    };
    const secondSelect = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "import-1",
              capsuleSha256: sessionCapsuleSha256(value),
              status: "stored",
              parentImportId: null,
            },
          ]),
        })),
      })),
    };
    const database = {
      select: vi
        .fn()
        .mockReturnValueOnce(firstSelect)
        .mockReturnValueOnce(secondSelect),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      update: vi.fn(),
    };
    const artifactStore = {
      get: vi.fn().mockResolvedValue({
        payload: new TextEncoder().encode("original transport"),
        mediaType: "application/vnd.codev.session-capsule.v0",
        sha256: "f".repeat(64),
        bytes: 18,
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };

    await expect(
      storeSessionImport(
        {
          workspaceId: "workspace-1",
          importedBy: "user-1",
          idempotencyKey: "same-capsule",
          capsule: value,
          artifact: new TextEncoder().encode("different transport framing"),
        },
        {
          database: database as never,
          artifactStore,
          appendEvent: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      importId: "import-1",
      created: false,
      status: "stored",
    });
    expect(artifactStore.get).toHaveBeenCalledOnce();
    expect(artifactStore.put).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });
});

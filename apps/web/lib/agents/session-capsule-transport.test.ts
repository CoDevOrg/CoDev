import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SessionCapsuleV0 } from "@codev/contracts";

import {
  decodeSessionCapsuleTransport,
  encodeSessionCapsuleTransport,
  MAX_SESSION_CAPSULE_TRANSPORT_BYTES,
} from "./session-capsule-transport";

const providerPayload = new TextEncoder().encode("native provider state");
const patch = new TextEncoder().encode("diff --git a/a b/a\n");

function digest(payload: Uint8Array) {
  return createHash("sha256").update(payload).digest("hex");
}

function capsule(): SessionCapsuleV0 {
  return {
    schemaVersion: 0,
    source: {
      provider: "cursor",
      externalSessionId: "cursor-session-1",
      payloadFormat: "cursor-fixture",
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
        text: "Continue the portable session.",
        createdAt: "2026-09-18T12:00:00.000Z",
      },
    ],
    handoff: {
      currentObjective: "Decode the capsule safely.",
      summary: "Transport verification is the next boundary.",
    },
    repositoryState: {
      patchPath: "repository/change.patch",
      approvedUntrackedPaths: [],
    },
    attachmentPaths: [],
    providerPayloadPath: "provider/session.payload",
    files: [
      {
        path: "provider/session.payload",
        role: "provider_payload",
        mediaType: "application/octet-stream",
        bytes: providerPayload.byteLength,
        sha256: digest(providerPayload),
        mode: "100644",
      },
      {
        path: "repository/change.patch",
        role: "git_patch",
        mediaType: "text/x-diff",
        bytes: patch.byteLength,
        sha256: digest(patch),
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

function files() {
  return new Map([
    ["provider/session.payload", providerPayload],
    ["repository/change.patch", patch],
  ]);
}

describe("session capsule transport", () => {
  it("round-trips canonical manifests and declared binary files", () => {
    const encoded = encodeSessionCapsuleTransport({
      capsule: capsule(),
      files: files(),
    });
    const decoded = decodeSessionCapsuleTransport(encoded);

    expect(decoded.capsule).toEqual(capsule());
    expect(decoded.files.get("provider/session.payload")).toEqual(
      providerPayload,
    );
    expect(decoded.files.get("repository/change.patch")).toEqual(patch);
  });

  it("rejects missing, extra, and checksum-mismatched file content", () => {
    expect(() =>
      encodeSessionCapsuleTransport({
        capsule: capsule(),
        files: new Map([["provider/session.payload", providerPayload]]),
      }),
    ).toThrow();

    const extra = files();
    extra.set("undeclared.txt", new Uint8Array([1]));
    expect(() =>
      encodeSessionCapsuleTransport({ capsule: capsule(), files: extra }),
    ).toThrow();

    const mismatched = files();
    mismatched.set("repository/change.patch", new Uint8Array(patch.byteLength));
    expect(() =>
      encodeSessionCapsuleTransport({ capsule: capsule(), files: mismatched }),
    ).toThrow();
  });

  it("rejects tampering, truncation, and undeclared trailing bytes", () => {
    const encoded = encodeSessionCapsuleTransport({
      capsule: capsule(),
      files: files(),
    });
    const tampered = encoded.slice();
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;
    expect(() => decodeSessionCapsuleTransport(tampered)).toThrow();
    expect(() => decodeSessionCapsuleTransport(encoded.slice(0, -1))).toThrow();

    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    expect(() => decodeSessionCapsuleTransport(trailing)).toThrow();
  });

  it("rejects malformed headers and oversized transports", () => {
    expect(() =>
      decodeSessionCapsuleTransport(new Uint8Array([1, 2, 3])),
    ).toThrow();
    expect(() =>
      decodeSessionCapsuleTransport(
        new Uint8Array(MAX_SESSION_CAPSULE_TRANSPORT_BYTES + 1),
      ),
    ).toThrow();
  });
});

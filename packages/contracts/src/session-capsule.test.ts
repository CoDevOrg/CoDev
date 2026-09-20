import { describe, expect, it } from "vitest";

import {
  importedAgentSessionViewSchema,
  importedSessionContinuationSchema,
  serializeSessionCapsuleV0Identity,
  sessionCapsuleV0Schema,
  type SessionCapsuleV0,
  type SessionProvider,
} from "./session-capsule";

const SHA256 = "a".repeat(64);
const BASE_SHA = "b".repeat(40);

function capsule(provider: SessionProvider = "codex"): SessionCapsuleV0 {
  return {
    schemaVersion: 0,
    source: {
      provider,
      externalSessionId: `${provider}-session-1`,
      payloadFormat: `${provider}-fixture`,
      payloadVersion: "1",
    },
    repository: {
      host: "github.com",
      path: "codev/example",
      baseCommitSha: BASE_SHA,
      sourceBranch: "feature/import",
      workingDirectory: ".",
    },
    transcript: [
      {
        sequence: 0,
        role: "user",
        authorName: null,
        text: "Continue the import foundation.",
        createdAt: "2026-09-18T12:00:00.000Z",
      },
      {
        sequence: 1,
        role: "assistant",
        authorName: provider,
        text: "The capsule contract is ready.",
        createdAt: "2026-09-18T12:01:00.000Z",
      },
    ],
    handoff: {
      currentObjective: "Build the provider-neutral capsule.",
      summary: "The contract is the first delivery milestone.",
    },
    repositoryState: {
      patchPath: "repository/change.patch",
      approvedUntrackedPaths: ["repository/untracked/context.json"],
    },
    attachmentPaths: ["attachments/diagram.png"],
    providerPayloadPath: "provider/session.payload",
    files: [
      {
        path: "repository/change.patch",
        role: "git_patch",
        mediaType: "text/x-diff",
        bytes: 100,
        sha256: SHA256,
        mode: "100644",
      },
      {
        path: "repository/untracked/context.json",
        role: "untracked_file",
        mediaType: "application/json",
        bytes: 100,
        sha256: SHA256,
        mode: "100644",
      },
      {
        path: "attachments/diagram.png",
        role: "attachment",
        mediaType: "image/png",
        bytes: 100,
        sha256: SHA256,
        mode: "100644",
      },
      {
        path: "provider/session.payload",
        role: "provider_payload",
        mediaType: "application/octet-stream",
        bytes: 100,
        sha256: SHA256,
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

describe("session capsule contracts", () => {
  it.each(["codex", "claude", "cursor"] as const)(
    "accepts a provider-neutral %s fixture",
    (provider) => {
      expect(
        sessionCapsuleV0Schema.parse(capsule(provider)).source.provider,
      ).toBe(provider);
    },
  );

  it("rejects provider-specific fields in the generic source", () => {
    expect(() =>
      sessionCapsuleV0Schema.parse({
        ...capsule(),
        source: { ...capsule().source, rolloutPath: ".codex/sessions/x.jsonl" },
      }),
    ).toThrow();
  });

  it.each([
    "/etc/passwd",
    "C:/Windows/System32",
    "../outside",
    "repository/../outside",
    "repository\\file.txt",
    "repository//file.txt",
  ])("rejects unsafe capsule paths: %s", (path) => {
    const value = capsule();
    const firstFile = value.files[0];
    if (!firstFile) throw new Error("Fixture is missing its patch file.");
    value.files[0] = { ...firstFile, path };
    expect(() => sessionCapsuleV0Schema.parse(value)).toThrow();
  });

  it("rejects duplicate paths and references with the wrong file role", () => {
    const duplicate = capsule();
    const patchFile = duplicate.files[0];
    const untrackedFile = duplicate.files[1];
    if (!patchFile || !untrackedFile) {
      throw new Error("Fixture is missing repository files.");
    }
    duplicate.files[1] = { ...untrackedFile, path: patchFile.path };
    expect(() => sessionCapsuleV0Schema.parse(duplicate)).toThrow();

    const wrongRole = capsule();
    const wrongRoleFile = wrongRole.files[0];
    if (!wrongRoleFile) throw new Error("Fixture is missing its patch file.");
    wrongRole.files[0] = { ...wrongRoleFile, role: "attachment" };
    expect(() => sessionCapsuleV0Schema.parse(wrongRole)).toThrow();
  });

  it("rejects non-contiguous transcript entries and oversized manifests", () => {
    const transcript = capsule();
    const secondEntry = transcript.transcript[1];
    if (!secondEntry) throw new Error("Fixture is missing its second entry.");
    transcript.transcript[1] = { ...secondEntry, sequence: 2 };
    expect(() => sessionCapsuleV0Schema.parse(transcript)).toThrow();

    const oversized = capsule();
    for (const file of oversized.files) file.bytes = 5 * 1_024 * 1_024;
    oversized.files.push(
      {
        path: "attachments/extra-one.bin",
        role: "attachment",
        mediaType: "application/octet-stream",
        bytes: 5 * 1_024 * 1_024,
        sha256: SHA256,
        mode: "100644",
      },
      {
        path: "attachments/extra-two.bin",
        role: "attachment",
        mediaType: "application/octet-stream",
        bytes: 5 * 1_024 * 1_024,
        sha256: SHA256,
        mode: "100644",
      },
    );
    expect(() => sessionCapsuleV0Schema.parse(oversized)).toThrow();
  });

  it("models the CoDev-native view and both future continuation paths", () => {
    const parsed = sessionCapsuleV0Schema.parse(capsule("claude"));
    expect(
      importedAgentSessionViewSchema.parse({
        source: {
          provider: parsed.source.provider,
          externalSessionId: parsed.source.externalSessionId,
        },
        repository: parsed.repository,
        transcript: parsed.transcript,
        handoff: parsed.handoff,
        nativeResume: { provider: "claude", availability: "unknown" },
      }).nativeResume.provider,
    ).toBe("claude");
    expect(
      importedSessionContinuationSchema.parse({
        kind: "managed",
        provider: "openai",
      }),
    ).toEqual({
      kind: "managed",
      provider: "openai",
    });
    expect(
      importedSessionContinuationSchema.parse({ kind: "native_resume" }),
    ).toEqual({
      kind: "native_resume",
    });
  });

  it("does not let a native resume claim another provider", () => {
    expect(() =>
      importedAgentSessionViewSchema.parse({
        source: { provider: "codex", externalSessionId: "codex-session-1" },
        repository: capsule().repository,
        transcript: capsule().transcript,
        handoff: capsule().handoff,
        nativeResume: { provider: "claude", availability: "available" },
      }),
    ).toThrow();
  });

  it("produces stable identity bytes for set-like manifest ordering", () => {
    const first = capsule();
    const reordered = capsule();
    reordered.files.reverse();
    reordered.attachmentPaths.reverse();
    reordered.repositoryState.approvedUntrackedPaths.reverse();

    expect(serializeSessionCapsuleV0Identity(reordered)).toEqual(
      serializeSessionCapsuleV0Identity(first),
    );
  });

  it("changes identity when semantic capsule content changes", () => {
    const first = capsule();
    const changed = capsule();
    const entry = changed.transcript[1];
    if (!entry) throw new Error("Fixture is missing its second entry.");
    changed.transcript[1] = { ...entry, text: "A different handoff result." };

    expect(serializeSessionCapsuleV0Identity(changed)).not.toEqual(
      serializeSessionCapsuleV0Identity(first),
    );
  });

  it("does not mutate the capsule while canonicalizing it", () => {
    const value = capsule();
    const pathsBefore = value.files.map((file) => file.path);

    serializeSessionCapsuleV0Identity(value);

    expect(value.files.map((file) => file.path)).toEqual(pathsBefore);
  });
});

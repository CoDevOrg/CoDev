import { z } from "zod";

import { timestampSchema } from "./domain";

/** The first stable CoDev interchange format for coding-agent sessions. */
export const SESSION_CAPSULE_SCHEMA_VERSION = 0;

export const sessionProviderSchema = z.enum(["codex", "claude", "cursor"]);
export type SessionProvider = z.infer<typeof sessionProviderSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, {
  message: "Expected a lowercase SHA-256 digest.",
});

/** A logical capsule path, never a destination path on a host machine. */
export const capsuleRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .superRefine((path, context) => {
    if (
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      path.includes("\\") ||
      path.includes("\0")
    ) {
      context.addIssue({
        code: "custom",
        message: "Capsule paths must be safe POSIX-relative paths.",
      });
      return;
    }
    if (
      path
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "Capsule paths cannot contain empty, dot, or parent segments.",
      });
    }
  });

export const capsuleFileRoleSchema = z.enum([
  "git_patch",
  "untracked_file",
  "attachment",
  "provider_payload",
]);

export const capsuleFileSchema = z
  .object({
    path: capsuleRelativePathSchema,
    role: capsuleFileRoleSchema,
    mediaType: z.string().trim().min(1).max(255),
    bytes: z
      .number()
      .int()
      .positive()
      .max(5 * 1_024 * 1_024),
    sha256: sha256Schema,
    mode: z.enum(["100644", "100755"]),
  })
  .strict();

export type CapsuleFile = z.infer<typeof capsuleFileSchema>;

const repositoryPathSchema = capsuleRelativePathSchema.or(z.literal("."));

/**
 * Credential-free repository identity. The exporter converts native Git URLs
 * into these components instead of carrying a URL that could embed a token.
 */
export const capsuleRepositorySchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9.-]+$/i),
    path: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .regex(/^[A-Za-z0-9._/-]+$/)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path
            .split("/")
            .some((segment) => !segment || segment === "." || segment === ".."),
        "Repository paths must be safe relative paths.",
      ),
    baseCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    sourceBranch: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\0\r\n]+$/),
    workingDirectory: repositoryPathSchema,
  })
  .strict();

export type CapsuleRepository = z.infer<typeof capsuleRepositorySchema>;

export const normalizedSessionTranscriptEntrySchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    role: z.enum(["user", "assistant", "system", "tool"]),
    authorName: z.string().trim().min(1).max(200).nullable(),
    text: z.string().max(1_024 * 1_024),
    createdAt: timestampSchema.nullable(),
  })
  .strict();

export type NormalizedSessionTranscriptEntry = z.infer<
  typeof normalizedSessionTranscriptEntrySchema
>;

export const normalizedSessionTranscriptSchema = z
  .array(normalizedSessionTranscriptEntrySchema)
  .min(1)
  .max(10_000)
  .superRefine((entries, context) => {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const entry = entries[index];
      if (!previous || !entry || entry.sequence !== previous.sequence + 1) {
        context.addIssue({
          code: "custom",
          message: "Transcript entries must have contiguous sequence numbers.",
          path: [index, "sequence"],
        });
      }
    }
  });

export type NormalizedSessionTranscript = z.infer<
  typeof normalizedSessionTranscriptSchema
>;

export const sessionHandoffSchema = z
  .object({
    currentObjective: z.string().trim().min(1).max(10_000),
    summary: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const sessionCapsuleSharingPolicySchema = z
  .object({
    normalizedView: z.literal("workspace"),
    opaqueProviderPayload: z.literal("importer"),
  })
  .strict();

export const sessionCapsuleV0Schema = z
  .object({
    schemaVersion: z.literal(SESSION_CAPSULE_SCHEMA_VERSION),
    source: z
      .object({
        provider: sessionProviderSchema,
        externalSessionId: z.string().trim().min(1).max(512),
        payloadFormat: z.string().trim().min(1).max(128),
        payloadVersion: z.string().trim().min(1).max(128),
      })
      .strict(),
    repository: capsuleRepositorySchema,
    transcript: normalizedSessionTranscriptSchema,
    handoff: sessionHandoffSchema,
    repositoryState: z
      .object({
        patchPath: capsuleRelativePathSchema.nullable(),
        approvedUntrackedPaths: z.array(capsuleRelativePathSchema).max(500),
      })
      .strict(),
    attachmentPaths: z.array(capsuleRelativePathSchema).max(500),
    providerPayloadPath: capsuleRelativePathSchema,
    files: z.array(capsuleFileSchema).min(1).max(500),
    sharing: sessionCapsuleSharingPolicySchema,
    createdAt: timestampSchema,
    exportedAt: timestampSchema,
  })
  .strict()
  .superRefine((capsule, context) => {
    const filesByPath = new Map<string, CapsuleFile>();
    let totalBytes = 0;
    for (const [index, file] of capsule.files.entries()) {
      totalBytes += file.bytes;
      if (filesByPath.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: "Capsule file paths must be unique.",
          path: ["files", index, "path"],
        });
      }
      filesByPath.set(file.path, file);
    }
    if (totalBytes > 25 * 1_024 * 1_024) {
      context.addIssue({
        code: "custom",
        message: "Capsule files exceed the 25 MiB total limit.",
        path: ["files"],
      });
    }

    const requireRole = (
      path: string,
      role: z.infer<typeof capsuleFileRoleSchema>,
      field: string,
    ) => {
      if (filesByPath.get(path)?.role !== role) {
        context.addIssue({
          code: "custom",
          message: `Expected ${field} to reference a ${role} file.`,
        });
      }
    };

    requireRole(
      capsule.providerPayloadPath,
      "provider_payload",
      "providerPayloadPath",
    );
    if (capsule.repositoryState.patchPath) {
      requireRole(capsule.repositoryState.patchPath, "git_patch", "patchPath");
    }
    for (const path of capsule.repositoryState.approvedUntrackedPaths) {
      requireRole(path, "untracked_file", "approvedUntrackedPaths");
    }
    for (const path of capsule.attachmentPaths) {
      requireRole(path, "attachment", "attachmentPaths");
    }
  });

export type SessionCapsuleV0 = z.infer<typeof sessionCapsuleV0Schema>;

export const importedSessionNativeResumeAvailabilitySchema = z.enum([
  "unknown",
  "available",
  "unavailable",
]);

/**
 * The CoDev-native view is safe for workspace collaboration. The opaque
 * provider payload remains outside this view and is only rehydrated for its
 * importing member.
 */
export const importedAgentSessionViewSchema = z
  .object({
    source: z
      .object({
        provider: sessionProviderSchema,
        externalSessionId: z.string().trim().min(1).max(512),
      })
      .strict(),
    repository: capsuleRepositorySchema,
    transcript: normalizedSessionTranscriptSchema,
    handoff: sessionHandoffSchema,
    nativeResume: z
      .object({
        provider: sessionProviderSchema,
        availability: importedSessionNativeResumeAvailabilitySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.nativeResume.provider !== view.source.provider) {
      context.addIssue({
        code: "custom",
        message:
          "Exact native resume is only available from the source provider.",
        path: ["nativeResume", "provider"],
      });
    }
  });

export type ImportedAgentSessionView = z.infer<
  typeof importedAgentSessionViewSchema
>;

/** A later lifecycle layer will evaluate these choices against member connections. */
export const importedSessionContinuationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("managed"),
      provider: z.string().trim().min(1).max(64),
    })
    .strict(),
  z.object({ kind: z.literal("native_resume") }).strict(),
]);

export type ImportedSessionContinuation = z.infer<
  typeof importedSessionContinuationSchema
>;

export type SessionPreview = {
  provider: SessionProvider;
  externalSessionId: string;
  nativeResumeAvailability: z.infer<
    typeof importedSessionNativeResumeAvailabilitySchema
  >;
  warnings: string[];
};

export type ProviderExportFile = Omit<CapsuleFile, "bytes" | "sha256"> & {
  contents: Uint8Array;
};

export type ProviderExport = {
  provider: SessionProvider;
  externalSessionId: string;
  payloadFormat: string;
  payloadVersion: string;
  files: readonly ProviderExportFile[];
};

export type SessionDestination = {
  workspaceId: string;
  worktreeId: string;
  /** Logical, safe relative directory below the destination worktree. */
  workingDirectory: string;
};

export type ProviderRehydrationResult = {
  nativeResumeAvailability: z.infer<
    typeof importedSessionNativeResumeAvailabilitySchema
  >;
  warnings: string[];
};

export type LaunchRecipe = {
  provider: SessionProvider;
  command: readonly string[];
  workingDirectory: string;
};

/** Provider-native work stays behind this boundary; repository restore is CoDev-owned. */
export interface SessionProviderAdapter<Source = unknown> {
  readonly provider: SessionProvider;
  inspect(source: Source): Promise<SessionPreview>;
  export(source: Source): Promise<ProviderExport>;
  normalize(exported: ProviderExport): Promise<NormalizedSessionTranscript>;
  rehydrate(
    capsule: SessionCapsuleV0,
    destination: SessionDestination,
  ): Promise<ProviderRehydrationResult>;
  launch(
    capsule: SessionCapsuleV0,
    destination: SessionDestination,
  ): Promise<LaunchRecipe>;
}

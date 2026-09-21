import "server-only";

import { createHash } from "node:crypto";

import {
  sessionCapsuleV0Schema,
  type SessionCapsuleV0,
  type SessionProvider,
} from "@codev/contracts";

import { parseCodexRolloutHeader } from "./codex-session-import";
import { encodeSessionCapsuleTransport } from "./session-capsule-transport";

export class SessionSourceImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type SourceAdapter = (bytes: Uint8Array) => Uint8Array;

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function codexRolloutToCapsule(bytes: Uint8Array): Uint8Array {
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SessionSourceImportError("The Codex rollout must be UTF-8 text.");
  }
  const header = parseCodexRolloutHeader(contents);
  const lines = contents.trimEnd().split("\n");
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(lines[0]!) as Record<string, unknown>;
  } catch {
    throw new SessionSourceImportError("The Codex rollout header is invalid.");
  }
  const payload = metadata.payload as Record<string, unknown>;
  const git = payload.git as Record<string, unknown> | undefined;
  const rawUrl = git?.repository_url;
  const commit = git?.commit_hash;
  const branch = git?.branch;
  let repository: URL;
  try {
    repository = new URL(rawUrl as string);
  } catch {
    throw new SessionSourceImportError(
      "This rollout has no usable Git repository identity. Choose a Codex session recorded in a Git repository.",
    );
  }
  if (
    repository.protocol !== "https:" ||
    repository.username ||
    repository.password ||
    repository.search ||
    repository.hash
  ) {
    throw new SessionSourceImportError(
      "The rollout Git repository URL must be a credential-free HTTPS URL.",
    );
  }
  const path = repository.pathname
    .replace(/^\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (typeof commit !== "string" || typeof branch !== "string") {
    throw new SessionSourceImportError(
      "This rollout has no Git commit or branch metadata.",
    );
  }

  const entries: {
    role: "user" | "assistant";
    text: string;
    createdAt: string | null;
  }[] = [];
  const fallback: typeof entries = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      timestamp?: string;
      payload?: Record<string, unknown>;
    };
    try {
      event = JSON.parse(line);
    } catch {
      throw new SessionSourceImportError(
        "The Codex rollout contains an invalid JSON line.",
      );
    }
    const item = event.payload;
    if (!item) continue;
    const createdAt =
      event.timestamp && !Number.isNaN(Date.parse(event.timestamp))
        ? new Date(event.timestamp).toISOString()
        : null;
    if (
      event.type === "event_msg" &&
      (item.type === "user_message" || item.type === "agent_message")
    ) {
      const text = textContent(item.message);
      if (text)
        entries.push({
          role: item.type === "user_message" ? "user" : "assistant",
          text,
          createdAt,
        });
    } else if (
      event.type === "response_item" &&
      item.type === "message" &&
      (item.role === "user" || item.role === "assistant")
    ) {
      const text = textContent(item.content);
      if (text) fallback.push({ role: item.role, text, createdAt });
    }
  }
  const messages = entries.length ? entries : fallback;
  if (!messages.length)
    throw new SessionSourceImportError(
      "The Codex rollout contains no user or assistant messages.",
    );
  if (messages.length > 10_000)
    throw new SessionSourceImportError(
      "The Codex rollout contains too many messages.",
      413,
    );
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const objective = (
    lastUser?.text ?? "Review the imported Codex session."
  ).slice(0, 10_000);
  const summary = (
    lastAssistant?.text ?? "Review the transcript to continue this session."
  ).slice(0, 20_000);
  const providerPayloadPath = "provider/codex-rollout.jsonl";
  const capsule: SessionCapsuleV0 = sessionCapsuleV0Schema.parse({
    schemaVersion: 0,
    source: {
      provider: "codex",
      externalSessionId: header.sessionId,
      payloadFormat: "codex-rollout-jsonl",
      payloadVersion: "1",
    },
    repository: {
      host: repository.hostname,
      path,
      baseCommitSha: commit,
      sourceBranch: branch,
      workingDirectory: ".",
    },
    transcript: messages.map((message, sequence) => ({
      sequence,
      ...message,
      authorName: null,
    })),
    handoff: { currentObjective: objective, summary },
    repositoryState: { patchPath: null, approvedUntrackedPaths: [] },
    attachmentPaths: [],
    providerPayloadPath,
    files: [
      {
        path: providerPayloadPath,
        role: "provider_payload",
        mediaType: "application/x-ndjson",
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mode: "100644",
      },
    ],
    sharing: { normalizedView: "workspace", opaqueProviderPayload: "importer" },
    createdAt: header.timestamp.toISOString(),
    exportedAt: header.timestamp.toISOString(),
  });
  return encodeSessionCapsuleTransport({
    capsule,
    files: new Map([[providerPayloadPath, bytes]]),
  });
}

// Source formats remain provider-owned; the capsule and storage paths stay shared.
const adapters: Partial<Record<SessionProvider, SourceAdapter>> = {
  codex: codexRolloutToCapsule,
};

export function importSessionSource(
  provider: SessionProvider,
  bytes: Uint8Array,
): Uint8Array {
  const adapter = adapters[provider];
  if (!adapter)
    throw new SessionSourceImportError(
      `${provider} source imports are not available yet.`,
      501,
    );
  if (!bytes.byteLength)
    throw new SessionSourceImportError("Choose a nonempty session file.");
  if (bytes.byteLength > 5 * 1_024 * 1_024)
    throw new SessionSourceImportError(
      "The source session exceeds the 5 MiB limit.",
      413,
    );
  try {
    return adapter(bytes);
  } catch (error) {
    if (error instanceof SessionSourceImportError) throw error;
    throw new SessionSourceImportError(
      "The source session could not be converted. Check its Git metadata and transcript.",
    );
  }
}

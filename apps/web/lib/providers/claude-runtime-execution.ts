import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { logEvent } from "../platform/observability";
import { launchProfileFor } from "./registry";
import { requireCredential } from "./resolve";
import {
  closeCodexExecInSandbox,
  destroySandbox,
  ensureHostReady,
  pollCodexExecInSandbox,
  provisionSandbox,
  startCodexExecInSandbox,
} from "../runtime/orchestrator";

/**
 * Running a chat-room reply on the member's Claude subscription.
 *
 * This used to resume a Firecracker snapshot kept per member — the login
 * runtime — because the only credential a Claude sign-in produced was the
 * signed-in profile left inside that VM. Nothing could be handed to another
 * host, so Claude could answer in a room and nowhere else, the snapshot had
 * to be carried indefinitely, and the module needed a second lease of its
 * own to stop two turns entering the same VM.
 *
 * The login now yields a `claude setup-token`, so a turn is an ordinary
 * ephemeral sandbox with that token in its launch profile: nothing to
 * resume, nothing to keep, and the same credential works in a workspace.
 * The seat is the shared one in `credential-seat.ts`, like every other
 * provider.
 */

// Official CLI aliases resolve on the signed-in account; do not claim specific
// dated API models are available to every subscription.
export const CLAUDE_RUNTIME_MODELS = ["sonnet", "opus", "haiku"];

const runSchema = z.object({
  sandboxId: z.string().min(1),
  sessionId: z.string().min(1),
});
type Run = z.infer<typeof runSchema>;

const prefix = "claude-exec-v2:";
export const isClaudeExecution = (value: string) => value.startsWith(prefix);

function decode(value: string): Run {
  if (!isClaudeExecution(value))
    throw new Error("Invalid Claude execution reference.");
  return runSchema.parse(
    JSON.parse(Buffer.from(value.slice(prefix.length), "base64url").toString()),
  );
}

function encode(run: Run) {
  return (
    prefix +
    Buffer.from(JSON.stringify(runSchema.parse(run))).toString("base64url")
  );
}

/**
 * `systemPrompt` appends to the CLI's own persona rather than replacing it, so
 * a caller that passes nothing keeps today's inherited coding-agent behavior.
 * Only the rooms executor passes one; see `chat/room-reply-prompt.ts`.
 */
export type ClaudePrintOptions = {
  outputSchema?: object | undefined;
  systemPrompt?: string | undefined;
  /**
   * `"stream-json"` emits events as the turn runs so a caller can show partial
   * text. The CLI requires `--verbose` alongside it under `--print`, and
   * `--include-partial-messages` is what makes the events token-level rather
   * than one whole message at the end. The final `{"type":"result"}` line is
   * still emitted, so `parseClaudeResult` reads either format.
   */
  outputFormat?: "json" | "stream-json" | undefined;
};

export function claudePrintArgs(
  model: string,
  {
    outputSchema,
    systemPrompt,
    outputFormat = "json",
  }: ClaudePrintOptions = {},
) {
  if (!CLAUDE_RUNTIME_MODELS.includes(model))
    throw new Error("Select an official Claude CLI model alias.");
  return [
    "-p",
    "--model",
    model,
    "--output-format",
    outputFormat,
    ...(outputFormat === "stream-json"
      ? ["--verbose", "--include-partial-messages"]
      : []),
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--max-turns",
    "2",
    ...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
    ...(outputSchema ? ["--json-schema", JSON.stringify(outputSchema)] : []),
  ];
}

export async function startClaudeExecution(
  userId: string,
  model: string,
  prompt: string,
  requestId: string,
  options: ClaudePrintOptions = {},
) {
  if (Buffer.byteLength(prompt) > 120_000)
    throw new Error("Claude context is too large; shorten the conversation.");
  const args = claudePrintArgs(model, options);
  const resolved = await requireCredential({
    userId,
    provider: "claude",
    surface: "rooms",
  });
  if (resolved.secret.kind !== "claude_setup_token") {
    throw new Error("Reconnect Claude in Settings.");
  }
  // The token reaches the process through the launch profile's environment,
  // never on the command line where another member's shell could read it out
  // of `ps`.
  const launchProfile = launchProfileFor("claude", resolved.secret);

  try {
    await ensureHostReady();
    // The orchestrator's create validation requires exactly one repository
    // source, so a reply that has no repository still ships a placeholder.
    const placeholder = "Claude reply.\n";
    await provisionSandbox({
      workspaceId: requestId,
      ephemeral: true,
      repositoryUrl: null,
      repositorySnapshot: {
        files: [
          {
            path: "README.md",
            mode: "100644",
            contentBase64: Buffer.from(placeholder).toString("base64"),
          },
        ],
        totalBytes: Buffer.byteLength(placeholder),
      },
      baseSha: "0".repeat(40),
      expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      resumeFromSnapshot: false,
      // A reply is minutes, not hours; the pause/auto-resume lifecycle the
      // orchestrator offers is for long-lived workspaces, and `cleanup`
      // destroys this one as soon as the turn ends either way.
      lifecycle: {
        timeoutMs: 20 * 60_000,
        lifecycle: { onTimeout: "pause", autoResume: true },
      },
    });
    const sessionId = await startCodexExecInSandbox(requestId, {
      command: ["timeout", "--kill-after=5", "240", "claude", ...args, prompt],
      launchProfile,
      idempotencyKey: requestId,
    });
    return encode({ sandboxId: requestId, sessionId });
  } catch (error) {
    // The curated message above is all a caller sees; record the real
    // (redacted) cause so operators can tell a cold host from a bad alias.
    logEvent("error", "claude_execution.start_failed", {
      requestId,
      detail: error instanceof Error ? error.message : String(error),
    });
    await destroySandbox(requestId).catch(() => {});
    throw new Error(
      "Claude could not start this reply. Try again in a moment.",
    );
  }
}

export async function pollClaudeExecution(id: string, after: number) {
  const run = decode(id);
  const result = await pollCodexExecInSandbox(
    run.sandboxId,
    run.sessionId,
    after,
  );
  return {
    chunks: result.chunks,
    exited: result.exited,
    exitCode: result.exitCode,
    nextSequence: result.nextSequence,
  };
}

export async function cleanupClaudeExecution(id: string) {
  const run = decode(id);
  try {
    await closeCodexExecInSandbox(run.sandboxId, run.sessionId);
  } finally {
    // Ephemeral: there is no profile worth keeping, so the sandbox goes even
    // if closing the process failed.
    await destroySandbox(run.sandboxId).catch(() => {});
  }
}

export const claudeResultSchema = z.object({
  type: z.literal("result"),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});
export function parseClaudeResult(output: string) {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const result = claudeResultSchema.safeParse(value);
    if (!result.success) continue;
    if (result.data.is_error) break;
    return result.data;
  }
  throw new Error("Official Claude Code returned no successful result.");
}

/**
 * Run a turn to completion. Built only on start/poll/cleanup, so it gained
 * the ephemeral sandbox without changing: the AI-SDK adapter in
 * `claude-runtime-model.ts` is its one caller.
 */
export async function completeClaudeExecution(
  userId: string,
  model: string,
  prompt: string,
  outputSchema?: object,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const id = await startClaudeExecution(userId, model, prompt, randomUUID(), {
    outputSchema,
  });
  try {
    let after = 0;
    const chunks: Buffer[] = [];
    let size = 0;
    const deadline = Date.now() + 260_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const poll = await pollClaudeExecution(id, after);
      after = poll.nextSequence;
      for (const chunk of poll.chunks) {
        const data = Buffer.from(chunk.dataBase64, "base64");
        size += data.length;
        chunks.push(data);
      }
      if (size > 4_000_000) throw new Error("Claude output limit exceeded.");
      if (poll.exited) {
        if (poll.exitCode !== 0)
          throw new Error(
            "Official Claude Code failed. Check your subscription connection.",
          );
        return parseClaudeResult(Buffer.concat(chunks).toString("utf8"));
      }
    }
    throw new Error("Claude execution timed out.");
  } finally {
    await cleanupClaudeExecution(id);
  }
}
